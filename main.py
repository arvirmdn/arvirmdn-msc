import asyncio
import functools
import re
import time

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
import yt_dlp

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

YDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "extract_flat": "in_playlist",
    "default_search": "ytsearch",
}

YDL_STREAM_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    # Prioritaskan m4a/AAC: format ini yang bisa diputar di Safari/iPhone.
    # WebM/Opus (default lama) TIDAK didukung Safari sama sekali.
    "format": "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best",
    "noplaylist": True,
    # Client "android"/"ios" biasanya lolos dari pembatasan/PO-token yang makin
    # sering diterapkan YouTube ke client "web" — kalau satu client gagal,
    # yt-dlp otomatis coba client berikutnya di daftar ini.
    "extractor_args": {
        "youtube": {
            "player_client": ["android", "ios", "web"],
        }
    },
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
    with yt_dlp.YoutubeDL(YDL_STREAM_OPTS) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
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
        return {"url": url, "ext": ext}


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=50)):
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


@app.get("/api/stream/{video_id}")
async def stream(video_id: str, request: Request):
    if not VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="video_id tidak valid")
    try:
        stream_info = await _run_sync(_get_audio_stream_info, video_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil audio: {exc}")

    audio_url = stream_info["url"]
    mime = EXT_MIME.get(stream_info["ext"], "audio/mp4")

    upstream_headers = dict(BROWSER_HEADERS)
    # Teruskan Range request dari <audio> browser (dibutuhkan untuk seek & buffering stabil)
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0),
        follow_redirects=True,
    )
    try:
        req = client.build_request("GET", audio_url, headers=upstream_headers)
        upstream_resp = await client.send(req, stream=True)
    except Exception as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Gagal konek ke sumber audio: {exc}")

    if upstream_resp.status_code >= 400:
        await upstream_resp.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=502,
            detail=f"Sumber audio menolak request (status {upstream_resp.status_code})",
        )

    resp_headers = {"accept-ranges": "bytes"}
    for h in ("content-range", "content-length"):
        if h in upstream_resp.headers:
            resp_headers[h] = upstream_resp.headers[h]

    async def proxy():
        try:
            async for chunk in upstream_resp.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    status_code = 206 if range_header and upstream_resp.status_code == 206 else 200
    return StreamingResponse(proxy(), status_code=status_code, media_type=mime, headers=resp_headers)


@app.get("/api/info/{video_id}")
async def info(video_id: str):
    if not VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="video_id tidak valid")
    try:
        data = await _run_sync(
            lambda vid: yt_dlp.YoutubeDL(YDL_STREAM_OPTS).extract_info(
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


app.mount("/", StaticFiles(directory="static", html=True), name="static")
