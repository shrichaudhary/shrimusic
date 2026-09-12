"""YouTube Music integration for ShriMusic.

Search / home feed use the WEB_REMIX Innertube endpoints (music.youtube.com).
Stream URL resolution uses yt-dlp — it handles YouTube's evolving signature
and PO-token requirements so the app always gets a directly playable audio URL.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
import yt_dlp  # type: ignore[import-untyped]


logger = logging.getLogger("shrimusic.youtube")

INNERTUBE_BASE = "https://music.youtube.com/youtubei/v1"
CLIENT_NAME = "WEB_REMIX"
CLIENT_VERSION = "1.20240101.01.00"
API_KEY = os.environ.get("YOUTUBE_INNERTUBE_KEY", "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
SONG_PARAM = "EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D"


def _context() -> Dict[str, Any]:
    return {
        "client": {
            "clientName": CLIENT_NAME,
            "clientVersion": CLIENT_VERSION,
            "hl": "en",
            "gl": "US",
        },
        "user": {"lockedSafetyMode": False},
    }


async def _post(path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{INNERTUBE_BASE}/{path}?key={API_KEY}&prettyPrint=false"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "Origin": "https://music.youtube.com",
        "Referer": "https://music.youtube.com/",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(url, headers=headers, json=body)
        response.raise_for_status()
        return response.json()


def _best_thumb(thumbnails: List[Dict[str, Any]]) -> Optional[str]:
    if not thumbnails:
        return None
    best = max(thumbnails, key=lambda item: item.get("width", 0) * item.get("height", 0))
    return best.get("url")


def _extract_runs(runs: Optional[List[Dict[str, Any]]]) -> str:
    if not runs:
        return ""
    return "".join(run.get("text", "") for run in runs)


def _flatten(node: Any, key: str, out: List[Dict[str, Any]]) -> None:
    if isinstance(node, dict):
        if key in node and isinstance(node[key], dict):
            out.append(node[key])
        for value in node.values():
            _flatten(value, key, out)
    elif isinstance(node, list):
        for item in node:
            _flatten(item, key, out)


def _clean_subtitle(text: str) -> str:
    """Turn 'Song • Artist Name • 3:15' or 'Video • Channel • 100M views' into just the middle bit."""
    if not text:
        return text
    parts = [p.strip() for p in text.split("•") if p.strip()]
    if len(parts) <= 1:
        return text.strip()
    # First part is often a type marker (Song, Video, Album, Single, EP, Playlist, Artist)
    type_markers = {"Song", "Video", "Album", "Single", "EP", "Playlist", "Artist"}
    if parts[0] in type_markers:
        parts = parts[1:]
    # Drop trailing "X views" / durations
    while parts and (parts[-1].endswith(" views") or parts[-1].count(":") == 1 or parts[-1].isdigit() or parts[-1].endswith(" plays")):
        parts.pop()
    return " • ".join(parts) if parts else text.strip()


def _parse_music_track(renderer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    video_id: Optional[str] = None
    endpoints: List[Dict[str, Any]] = []
    _flatten(renderer, "watchEndpoint", endpoints)
    for ep in endpoints:
        if ep.get("videoId"):
            video_id = ep["videoId"]
            break
    if not video_id:
        return None

    title = ""
    artist = ""
    subtitle_type = ""
    flex_columns = renderer.get("flexColumns") or []
    for i, col in enumerate(flex_columns):
        inner = col.get("musicResponsiveListItemFlexColumnRenderer") or {}
        text = _extract_runs((inner.get("text") or {}).get("runs"))
        if i == 0:
            title = text
        elif i == 1 and not artist:
            artist = text
            first_bit = text.split("•")[0].strip() if text else ""
            subtitle_type = first_bit

    if not title:
        title = _extract_runs(((renderer.get("title") or {}).get("runs")))
    if not artist:
        artist = _extract_runs(((renderer.get("subtitle") or {}).get("runs")))

    thumbnails = ((renderer.get("thumbnail") or {}).get("musicThumbnailRenderer") or {}).get("thumbnail", {}).get("thumbnails") or []
    if not thumbnails:
        thumbnails = ((renderer.get("thumbnail") or {}).get("thumbnails")) or []

    # Skip podcasts / episodes — they aren't music.
    if subtitle_type in {"Episode", "Podcast"}:
        return None

    return {
        "id": video_id,
        "title": title.strip(),
        "artist": _clean_subtitle(artist),
        "art_url": _best_thumb(thumbnails),
    }


async def search_tracks(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    body = {"context": _context(), "query": query}
    try:
        data = await _post("search", body)
    except httpx.HTTPError as exc:
        logger.warning("YouTube search failed for %r: %s", query, exc)
        return []

    items: List[Dict[str, Any]] = []
    _flatten(data, "musicResponsiveListItemRenderer", items)
    _flatten(data, "musicTwoRowItemRenderer", items)

    tracks: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for renderer in items:
        parsed = _parse_music_track(renderer)
        if not parsed or parsed["id"] in seen:
            continue
        seen.add(parsed["id"])
        tracks.append(parsed)
        if len(tracks) >= limit:
            break
    return tracks


async def home_feed(limit: int = 24) -> List[Dict[str, Any]]:
    """Fetch trending music. YT Music's public home feed requires auth these days,
    so we fall back to a broad music-search query for the discovery grid."""
    # First try the anonymous home browse (works occasionally on some regions)
    body = {"context": _context(), "browseId": "FEmusic_home"}
    try:
        data = await _post("browse", body)
    except httpx.HTTPError as exc:
        logger.warning("YouTube home feed failed: %s", exc)
        data = {}

    items: List[Dict[str, Any]] = []
    _flatten(data, "musicResponsiveListItemRenderer", items)
    _flatten(data, "musicTwoRowItemRenderer", items)

    tracks: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for renderer in items:
        parsed = _parse_music_track(renderer)
        if not parsed or parsed["id"] in seen:
            continue
        seen.add(parsed["id"])
        tracks.append(parsed)
        if len(tracks) >= limit:
            break

    if tracks:
        return tracks

    # Fallback: aggregate results from a couple of high-signal queries.
    fallback_queries = ["top hits 2025", "trending songs", "arijit singh hits", "weekend chill"]
    for q in fallback_queries:
        found = await search_tracks(q, limit=8)
        for t in found:
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            tracks.append(t)
            if len(tracks) >= limit:
                return tracks
    return tracks


# ---- Stream resolution via yt-dlp ---------------------------------------------------


_YDL_OPTS: Dict[str, Any] = {
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "skip_download": True,
    "extract_flat": False,
    "geo_bypass": True,
    # Prefer clients that still expose direct URLs
    "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
}


def _extract_sync(video_id: str) -> Optional[Dict[str, Any]]:
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(_YDL_OPTS) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as exc:  # noqa: BLE001
            logger.warning("yt-dlp failed for %s: %s", video_id, exc)
            return None

    formats = info.get("formats") or []
    audio_only = [
        f for f in formats
        if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none") and f.get("url")
    ]
    audio_only.sort(key=lambda f: (f.get("abr") or 0), reverse=True)
    chosen = audio_only[0] if audio_only else None
    stream_url = (chosen or {}).get("url") or info.get("url")

    if not stream_url:
        return None

    thumbnails = info.get("thumbnails") or []
    art_url = _best_thumb(thumbnails)

    return {
        "id": info.get("id") or video_id,
        "title": info.get("title") or "",
        "artist": info.get("uploader") or info.get("channel") or info.get("artist") or "",
        "duration_seconds": int(info.get("duration") or 0) or None,
        "stream_url": stream_url,
        "mime_type": (chosen or {}).get("ext"),
        "bitrate": (chosen or {}).get("abr"),
        "art_url": art_url,
    }


async def get_stream(video_id: str) -> Optional[Dict[str, Any]]:
    return await asyncio.to_thread(_extract_sync, video_id)
