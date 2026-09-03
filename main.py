import asyncio
import functools
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image, ImageOps
import glob
import httpx
import shutil
import tempfile
import yt_dlp
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

# ---------- Rate limiting ----------
# Dibatasi per-IP. Endpoint yang rawan disalahgunakan (login/register/reset/
# search/stream) dikasih limit lebih ketat lewat decorator @limiter.limit(...)
# di masing-masing endpoint-nya di bawah.
limiter = Limiter(key_func=get_remote_address)

# ---------- Database (akun & playlist) ----------
# Catatan penting: di Railway, file ini hilang tiap kali redeploy KECUALI kamu
# pasang Railway Volume dan arahkan DB_PATH ke path di dalam volume itu
# (mis. DB_PATH=/data/musikin.db). Tanpa volume, akun & playlist akan reset
# setiap kali kamu push perubahan baru.
DB_PATH = os.environ.get("DB_PATH", "musikin.db")

# Foto profil disimpan sebagai file JPG di folder ini, sengaja diletakkan
# bersebelahan dengan file database supaya kalau kamu pasang Railway Volume
# untuk DB_PATH, foto profil ikut aman di volume yang sama.
AVATAR_DIR = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "avatars")
MAX_AVATAR_BYTES = 5 * 1024 * 1024
ALLOWED_AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                tracks TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        # Migrasi ringan untuk DB lama yang dibuat sebelum fitur foto profil ada.
        user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "avatar_version" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN avatar_version INTEGER DEFAULT 0")
        # Kolom buat fitur reset password tanpa email: kode pemulihan (recovery
        # code) yang ditampilkan sekali ke user saat daftar / regenerasi, lalu
        # cuma disimpan hash-nya di sini (bukan plaintext).
        if "recovery_code_hash" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT")
        if "recovery_code_salt" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN recovery_code_salt TEXT")
        conn.commit()


_init_db()


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _hash_password(password: str, salt: Optional[str] = None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 150_000)
    return digest.hex(), salt


def _now():
    return datetime.now(timezone.utc).isoformat()


def _generate_recovery_code() -> str:
    """Kode pemulihan yang gampang dibaca/ditulis ulang manusia, mis. AB12-CD34-EF56."""
    raw = secrets.token_hex(6).upper()  # 12 karakter hex
    return "-".join(raw[i:i + 4] for i in range(0, 12, 4))


def _set_recovery_code(conn, user_id: int) -> str:
    """Generate kode baru, simpan hash-nya, kembalikan plaintext-nya (cuma sekali ini)."""
    code = _generate_recovery_code()
    code_hash, salt = _hash_password(code)
    conn.execute(
        "UPDATE users SET recovery_code_hash = ?, recovery_code_salt = ? WHERE id = ?",
        (code_hash, salt, user_id),
    )
    return code


USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")


class RegisterRequest(BaseModel):
    username: str
    password: str
    confirm_password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class PlaylistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class PlaylistUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    tracks: Optional[List[dict]] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_new_password: str


class ResetPasswordRequest(BaseModel):
    username: str
    recovery_code: str
    new_password: str
    confirm_new_password: str


class RegenerateRecoveryRequest(BaseModel):
    current_password: str


def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Belum login")
    token = authorization.split(" ", 1)[1].strip()
    with get_db() as conn:
        row = conn.execute(
            "SELECT users.id AS id, users.username AS username, users.created_at AS created_at "
            "FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token = ?",
            (token,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Sesi tidak valid, silakan login lagi")
    return {"id": row["id"], "username": row["username"], "created_at": row["created_at"]}

# Header ini WAJIB dikirim ke server audio YouTube (googlevideo.com), kalau tidak
# sering di-cut/403 di tengah jalan — inilah penyebab audio "mati sendiri".
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.youtube.com/",
    "Origin": "https://www.youtube.com",
}

EXT_MIME = {
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "webm": "audio/webm",
    "opus": "audio/ogg",
}

app = FastAPI(title="Web Musik - YouTube Auto Search")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Izinkan diakses dari domain manapun (silakan batasi ke domain frontend-mu di production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Kategori yang muncul di halaman Home (gaya Spotify: beberapa baris/section).
# Query di sini yang dipakai buat "nyari" ke YouTube, judul di sebelah kiri yang
# ditampilkan ke user. Bebas diubah/ditambah sesuai selera.
HOME_SECTIONS = [
    ("Trending Sekarang", "lagu trending indonesia terbaru"),
    ("Lagu Pop Terbaru", "lagu pop indonesia terbaru"),
    ("Top Hits Global", "top global hits 2026"),
    ("Lagi Viral", "lagu viral tiktok terbaru"),
]

_home_cache = {"data": None, "ts": 0}
HOME_CACHE_TTL = 20 * 60  # detik — biar gak nge-hit yt-dlp tiap kali tab Home dibuka

# Kalau YouTube sering nge-block/nge-throttle IP server (umum banget di
# hosting cloud kayak Railway), pasang file cookies.txt (export dari browser
# yang login YouTube, pakai extension "Get cookies.txt") lalu set env var
# COOKIES_FILE ke path-nya. Kosongin/hilangin env var ini kalau gak butuh.
COOKIES_FILE = os.environ.get("COOKIES_FILE", "").strip()
_cookies_opt = {"cookiefile": COOKIES_FILE} if COOKIES_FILE and os.path.exists(COOKIES_FILE) else {}

# Retry/timeout bawaan yt-dlp sendiri — biar gangguan jaringan sesaat gak
# langsung bikin request gagal total.
_RESILIENCE_OPTS = {
    "retries": 5,
    "fragment_retries": 5,
    "extractor_retries": 3,
    "socket_timeout": 15,
}

YDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "extract_flat": "in_playlist",
    "default_search": "ytsearch",
    **_RESILIENCE_OPTS,
    **_cookies_opt,
}

# Beberapa kombinasi player_client dicoba berurutan sampai salah satu berhasil
# ambil URL audio yang valid. "android"/"ios" biasanya lolos dari pembatasan
# PO-token yang makin sering diterapkan YouTube ke client "web".
# "web_embedded" ditambahkan sebagai fallback terakhir karena per pertengahan
# 2026 client ini paling jarang butuh PO-token dibanding "web" biasa.
#
# PENTING: sejak yt-dlp 2025.11.12, YouTube MEWAJIBKAN "JS runtime" (Deno)
# terpasang di server supaya semua client di atas (termasuk android/ios) bisa
# konsisten dapat URL audio yang valid. Tanpa Deno, yt-dlp tetap jalan tapi
# sering gagal diam-diam / dapat format yang cepat expired — persis gejala
# "audio gagal diputar / tersendat". Lihat nixpacks.toml di root proyek ini
# yang sudah memasang Deno otomatis saat build di Railway.
PLAYER_CLIENT_ATTEMPTS = [["android"], ["ios"], ["web"], ["web_embedded"], ["android", "ios", "web"]]

YDL_STREAM_OPTS_BASE = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    # Prioritaskan m4a/AAC: format ini yang bisa diputar di Safari/iPhone.
    # WebM/Opus (default lama) TIDAK didukung Safari sama sekali.
    "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best",
    "noplaylist": True,
    **_RESILIENCE_OPTS,
    **_cookies_opt,
}


def _run_sync(func, *args, **kwargs):
    """Jalankan fungsi blocking (yt-dlp) di thread terpisah supaya tidak nge-block event loop."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, functools.partial(func, *args, **kwargs))


def _search_youtube(query: str, limit: int = 20):
    with yt_dlp.YoutubeDL(YDL_SEARCH_OPTS) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        entries = info.get("entries", []) if info else []
        results = []
        for e in entries:
            if not e:
                continue
            vid = e.get("id")
            if not vid:
                continue
            duration = e.get("duration")
            thumb = None
            thumbs = e.get("thumbnails") or []
            if thumbs:
                thumb = thumbs[-1].get("url")
            else:
                thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
            results.append({
                "id": vid,
                "title": e.get("title") or "Tanpa judul",
                "artist": e.get("channel") or e.get("uploader") or "",
                "duration": duration,
                "thumbnail": thumb,
            })
        return results


def _get_audio_stream_info(video_id: str) -> dict:
    last_error = None
    for clients in PLAYER_CLIENT_ATTEMPTS:
        opts = {
            **YDL_STREAM_OPTS_BASE,
            "extractor_args": {"youtube": {"player_client": clients}},
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                url = info.get("url")
                ext = info.get("ext") or "m4a"
                if not url:
                    formats = info.get("formats") or []
                    # Audio-only (tanpa video), utamakan m4a demi kompatibilitas iPhone/Safari
                    audio_formats = [
                        f for f in formats
                        if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")
                    ]
                    if not audio_formats:
                        raise RuntimeError("Tidak ada format audio ditemukan")
                    audio_formats.sort(
                        key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0),
                        reverse=True,
                    )
                    chosen = audio_formats[0]
                    url = chosen["url"]
                    ext = chosen.get("ext") or "m4a"
                if not url:
                    raise RuntimeError("URL audio kosong")
                return {"url": url, "ext": ext}
        except Exception as exc:  # coba client berikutnya sebelum benar-benar menyerah
            last_error = exc
            time.sleep(0.4)
            continue
    raise last_error or RuntimeError("Gagal mengambil audio dari semua client")


@app.get("/api/search")
@limiter.limit("30/minute")
async def search(request: Request, q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=50)):
    try:
        results = await _run_sync(_search_youtube, q, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mencari: {exc}")
    return {"query": q, "results": results}


@app.get("/api/home")
async def home():
    now = time.time()
    if _home_cache["data"] is not None and (now - _home_cache["ts"]) < HOME_CACHE_TTL:
        return _home_cache["data"]

    async def build_section(title: str, query: str):
        try:
            tracks = await _run_sync(_search_youtube, query, 12)
        except Exception:
            tracks = []
        return {"title": title, "tracks": tracks}

    sections = await asyncio.gather(
        *(build_section(title, query) for title, query in HOME_SECTIONS)
    )
    sections = [s for s in sections if s["tracks"]]
    payload = {"sections": sections}
    _home_cache["data"] = payload
    _home_cache["ts"] = now
    return payload




def download_audio_file(video_id: str) -> tuple:
    """Download audio from YouTube, convert to MP3, return filepath and temp_dir."""
    tmp_dir = tempfile.mkdtemp(prefix="dl_")
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "noplaylist": True,
        "socket_timeout": 30,
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            url = f"https://www.youtube.com/watch?v={video_id}"
            ydl.download([url])
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    files = [f for f in glob.glob(os.path.join(tmp_dir, "*")) if os.path.isfile(f)]
    mp3s = [f for f in files if f.lower().endswith(".mp3")]
    chosen = mp3s or files
    if not chosen:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise RuntimeError("File audio hasil download tidak ditemukan di server.")
    return chosen[0], tmp_dir


@app.get("/api/stream/{video_id}")
@limiter.limit("20/minute")
async def stream(request: Request, video_id: str):
    """Download audio dari YouTube ke server, lalu serve sebagai file MP3.
    Cara ini mirip WEB ALLMENU — tidak streaming langsung, tapi download dulu.
    """
    if not VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="video_id tidak valid")
    try:
        filepath, tmp_dir = await _run_sync(download_audio_file, video_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengunduh audio: {exc}")
    return FileResponse(
        filepath,
        media_type="audio/mpeg",
        filename=f"{video_id}.mp3",
        background=BackgroundTask(lambda: shutil.rmtree(tmp_dir, ignore_errors=True)),
    )


@app.get("/api/info/{video_id}")
async def info(video_id: str):
    if not VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="video_id tidak valid")
    try:
        data = await _run_sync(
            lambda vid: yt_dlp.YoutubeDL(
                {**YDL_STREAM_OPTS_BASE, "extractor_args": {"youtube": {"player_client": ["android", "ios", "web"]}}}
            ).extract_info(
                f"https://www.youtube.com/watch?v={vid}", download=False
            ),
            video_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil info: {exc}")
    return {
        "id": video_id,
        "title": data.get("title"),
        "artist": data.get("channel") or data.get("uploader"),
        "duration": data.get("duration"),
        "thumbnail": (data.get("thumbnails") or [{}])[-1].get("url"),
    }



# ---------- Auth ----------
@app.post("/api/auth/register")
@limiter.limit("5/hour")
async def register(request: Request, payload: RegisterRequest):
    username = payload.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Nama pengguna harus 3-20 karakter, hanya huruf/angka/underscore",
        )
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Kata sandi minimal 6 karakter")
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Konfirmasi kata sandi tidak cocok")

    password_hash, salt = _hash_password(payload.password)
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Nama pengguna sudah dipakai")
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
            (username, password_hash, salt, _now()),
        )
        user_id = cur.lastrowid
        token = secrets.token_hex(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, _now()),
        )
        recovery_code = _set_recovery_code(conn, user_id)
        conn.commit()
    # recovery_code cuma dikirim SEKALI di sini (plaintext) — server cuma nyimpen
    # hash-nya. Kalau hilang, user harus login dulu buat generate ulang.
    return {"token": token, "username": username, "recovery_code": recovery_code}


@app.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest):
    username = payload.username.strip()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, password_hash, salt FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Nama pengguna atau kata sandi salah")
        check_hash, _ = _hash_password(payload.password, row["salt"])
        if not secrets.compare_digest(check_hash, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Nama pengguna atau kata sandi salah")
        token = secrets.token_hex(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, row["id"], _now()),
        )
        conn.commit()
    return {"token": token, "username": username}


@app.post("/api/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        with get_db() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            conn.commit()
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?", (user["id"],)
        ).fetchone()
        urow = conn.execute(
            "SELECT avatar_version FROM users WHERE id = ?", (user["id"],)
        ).fetchone()
    avatar_version = (urow["avatar_version"] if urow else 0) or 0
    avatar_url = f"/api/avatar/{user['id']}?v={avatar_version}" if avatar_version else None
    return {**user, "playlist_count": row["n"], "avatar_url": avatar_url}


@app.put("/api/auth/password")
async def change_password(payload: ChangePasswordRequest, user=Depends(get_current_user)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Kata sandi baru minimal 6 karakter")
    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(status_code=400, detail="Konfirmasi kata sandi baru tidak cocok")
    with get_db() as conn:
        row = conn.execute(
            "SELECT password_hash, salt FROM users WHERE id = ?", (user["id"],)
        ).fetchone()
        check_hash, _ = _hash_password(payload.current_password, row["salt"])
        if not secrets.compare_digest(check_hash, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Kata sandi saat ini salah")
        new_hash, new_salt = _hash_password(payload.new_password)
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (new_hash, new_salt, user["id"]),
        )
        # Sekalian putus semua sesi lain demi keamanan, kecuali biarkan yang ini tetap harus login ulang juga
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        conn.commit()
    return {"ok": True}


@app.post("/api/auth/reset-password")
@limiter.limit("5/minute")
async def reset_password(request: Request, payload: ResetPasswordRequest):
    username = payload.username.strip()
    code = payload.recovery_code.strip().upper()
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Kata sandi baru minimal 6 karakter")
    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(status_code=400, detail="Konfirmasi kata sandi baru tidak cocok")

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, recovery_code_hash, recovery_code_salt FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        # Balasan generik biar gak bocorin username mana yang valid.
        invalid_msg = "Nama pengguna atau kode pemulihan salah"
        if not row or not row["recovery_code_hash"]:
            raise HTTPException(status_code=401, detail=invalid_msg)
        check_hash, _ = _hash_password(code, row["recovery_code_salt"])
        if not secrets.compare_digest(check_hash, row["recovery_code_hash"]):
            raise HTTPException(status_code=401, detail=invalid_msg)

        new_hash, new_salt = _hash_password(payload.new_password)
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (new_hash, new_salt, row["id"]),
        )
        # Putus semua sesi lama demi keamanan, dan kode dirotasi (sekali pakai)
        # supaya kode yang sama gak bisa dipakai berulang kalau pernah bocor.
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        new_code = _set_recovery_code(conn, row["id"])
        conn.commit()
    return {"ok": True, "recovery_code": new_code}


@app.post("/api/auth/recovery-code/regenerate")
async def regenerate_recovery_code(payload: RegenerateRecoveryRequest, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT password_hash, salt FROM users WHERE id = ?", (user["id"],)
        ).fetchone()
        check_hash, _ = _hash_password(payload.current_password, row["salt"])
        if not secrets.compare_digest(check_hash, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Kata sandi salah")
        new_code = _set_recovery_code(conn, user["id"])
        conn.commit()
    return {"recovery_code": new_code}


def _avatar_path(user_id: int) -> str:
    return os.path.join(AVATAR_DIR, f"{user_id}.jpg")


@app.post("/api/auth/avatar")
async def upload_avatar(file: UploadFile = File(...), user=Depends(get_current_user)):
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="Format foto harus JPG, PNG, atau WEBP")

    raw = await file.read()
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Ukuran foto maksimal 5MB")

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # perbaiki rotasi foto dari HP
        img = img.convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="File bukan gambar yang valid")

    # Crop jadi persegi (ambil bagian tengah) lalu resize ke 256x256
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((256, 256), Image.LANCZOS)

    os.makedirs(AVATAR_DIR, exist_ok=True)
    img.save(_avatar_path(user["id"]), "JPEG", quality=87)

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET avatar_version = COALESCE(avatar_version, 0) + 1 WHERE id = ?",
            (user["id"],),
        )
        conn.commit()
        row = conn.execute(
            "SELECT avatar_version FROM users WHERE id = ?", (user["id"],)
        ).fetchone()

    return {"avatar_url": f"/api/avatar/{user['id']}?v={row['avatar_version']}"}


@app.delete("/api/auth/avatar")
async def delete_avatar(user=Depends(get_current_user)):
    path = _avatar_path(user["id"])
    if os.path.exists(path):
        os.remove(path)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET avatar_version = COALESCE(avatar_version, 0) + 1 WHERE id = ?",
            (user["id"],),
        )
        conn.commit()
    return {"ok": True}


@app.get("/api/avatar/{user_id}")
async def get_avatar(user_id: int):
    path = _avatar_path(user_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Belum ada foto profil")
    return FileResponse(path, media_type="image/jpeg")


# ---------- Playlist (tersimpan per akun, bukan lagi localStorage) ----------
def _playlist_row_to_dict(row):
    return {"id": row["id"], "name": row["name"], "tracks": json.loads(row["tracks"])}


@app.get("/api/playlists")
async def list_playlists(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, tracks FROM playlists WHERE user_id = ? ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return {"playlists": [_playlist_row_to_dict(r) for r in rows]}


@app.post("/api/playlists")
async def create_playlist(payload: PlaylistCreate, user=Depends(get_current_user)):
    playlist_id = f"pl_{secrets.token_hex(8)}"
    with get_db() as conn:
        conn.execute(
            "INSERT INTO playlists (id, user_id, name, tracks, updated_at) VALUES (?, ?, ?, ?, ?)",
            (playlist_id, user["id"], payload.name.strip(), "[]", _now()),
        )
        conn.commit()
    return {"id": playlist_id, "name": payload.name.strip(), "tracks": []}


@app.put("/api/playlists/{playlist_id}")
async def update_playlist(playlist_id: str, payload: PlaylistUpdate, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, tracks FROM playlists WHERE id = ? AND user_id = ?",
            (playlist_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Playlist tidak ditemukan")
        new_name = payload.name.strip() if payload.name is not None else row["name"]
        new_tracks = json.dumps(payload.tracks) if payload.tracks is not None else row["tracks"]
        conn.execute(
            "UPDATE playlists SET name = ?, tracks = ?, updated_at = ? WHERE id = ?",
            (new_name, new_tracks, _now(), playlist_id),
        )
        conn.commit()
    return {"id": playlist_id, "name": new_name, "tracks": json.loads(new_tracks)}


@app.delete("/api/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Playlist tidak ditemukan")
        conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        conn.commit()
    return {"ok": True}


app.mount("/", StaticFiles(directory="static", html=True), name="static")
