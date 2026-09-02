import asyncio
import functools
import re
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
import yt_dlp

app = FastAPI(title="Web Musik - YouTube Auto Search")

# Izinkan diakses dari domain manapun (silakan batasi ke domain frontend-mu di production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

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
    "format": "bestaudio/best",
    "noplaylist": True,
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


def _get_audio_url(video_id: str) -> str:
    with yt_dlp.YoutubeDL(YDL_STREAM_OPTS) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        url = info.get("url")
        if not url:
            formats = info.get("formats") or []
            audio_formats = [f for f in formats if f.get("acodec") not in (None, "none")]
            if not audio_formats:
                raise RuntimeError("Tidak ada format audio ditemukan")
            audio_formats.sort(key=lambda f: f.get("abr") or 0, reverse=True)
            url = audio_formats[0]["url"]
        return url


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), limit: int = Query(20, ge=1, le=50)):
    try:
        results = await _run_sync(_search_youtube, q, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mencari: {exc}")
    return {"query": q, "results": results}


@app.get("/api/stream/{video_id}")
async def stream(video_id: str, request: Optional[str] = None):
    if not VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="video_id tidak valid")
    try:
        audio_url = await _run_sync(_get_audio_url, video_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil audio: {exc}")

    # Proxy stream-nya lewat backend supaya <audio> di frontend tidak kena blokir/CORS dari googlevideo
    async def proxy():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", audio_url) as resp:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    return StreamingResponse(proxy(), media_type="audio/webm")


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
