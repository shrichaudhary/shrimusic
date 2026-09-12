"""Lyrics providers for ShriMusic.

Primary: LRCLIB (open, no auth) — https://lrclib.net
Fallback: KuGou mobile API (public)

Both return plain lyrics + optional synced LRC. We normalize into a common shape:
  {"synced": [{"time": seconds, "text": str}, ...] | None, "plain": str | None,
   "source": "lrclib" | "kugou", "cached": bool}
"""

from __future__ import annotations

import logging
import re
import time
from hashlib import md5
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger("shrimusic.lyrics")

_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_TTL = 60 * 60  # 1 hour in-memory cache

LRC_LINE = re.compile(r"\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\](.*)")


def _parse_lrc(text: str) -> List[Dict[str, Any]]:
    lines: List[Dict[str, Any]] = []
    for raw in text.splitlines():
        m = LRC_LINE.match(raw.strip())
        if not m:
            continue
        minutes, seconds, millis, body = m.group(1), m.group(2), m.group(3), m.group(4)
        t = int(minutes) * 60 + int(seconds)
        if millis:
            frac = int(millis)
            frac_scale = 10 ** len(millis)
            t += frac / frac_scale
        lines.append({"time": round(t, 2), "text": body.strip()})
    lines.sort(key=lambda item: item["time"])
    return lines


async def _lrclib(title: str, artist: str, duration: Optional[int]) -> Optional[Dict[str, Any]]:
    params = {"track_name": title, "artist_name": artist}
    if duration:
        params["duration"] = str(duration)
    url = "https://lrclib.net/api/get"
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "ShriMusic/1.0"}) as client:
            response = await client.get(url, params=params)
            if response.status_code == 404:
                # Fall back to a fuzzy search
                search = await client.get("https://lrclib.net/api/search", params={"track_name": title, "artist_name": artist})
                if search.status_code != 200:
                    return None
                results = search.json()
                if not results:
                    return None
                # Pick the closest match (first result is usually best)
                response_data = results[0]
            elif response.status_code != 200:
                return None
            else:
                response_data = response.json()
    except httpx.HTTPError as exc:
        logger.warning("LRCLIB request failed: %s", exc)
        return None

    synced_raw = response_data.get("syncedLyrics") or ""
    plain = response_data.get("plainLyrics") or None
    synced = _parse_lrc(synced_raw) if synced_raw else None
    if not synced and not plain:
        return None
    return {"synced": synced, "plain": plain, "source": "lrclib"}


async def _kugou(title: str, artist: str, duration: Optional[int]) -> Optional[Dict[str, Any]]:
    """KuGou search + download flow. Their servers accept a keyword, then id+accesskey."""
    keyword = f"{artist} - {title}".strip(" -")
    search_url = "https://mobileservice.kugou.com/api/v3/lyric/search"
    try:
        async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "ShriMusic/1.0"}) as client:
            response = await client.get(
                search_url,
                params={"version": 9108, "highlight": "", "keyword": keyword, "pagesize": 5, "page": 1},
            )
            response.raise_for_status()
            data = response.json()
            candidates = ((data.get("data") or {}).get("info")) or []
            if not candidates:
                return None
            # Pick the closest by duration (if provided)
            if duration:
                candidates.sort(key=lambda c: abs(int(c.get("duration") or 0) - duration))
            best = candidates[0]
            fetch = await client.get(
                "https://lyrics.kugou.com/download",
                params={"ver": 1, "client": "pc", "id": best["id"], "accesskey": best["accesskey"], "fmt": "lrc", "charset": "utf8"},
            )
            fetch.raise_for_status()
            payload = fetch.json()
            content = payload.get("content")
            if not content:
                return None
            import base64
            lrc_text = base64.b64decode(content).decode("utf-8", errors="ignore")
            synced = _parse_lrc(lrc_text)
            if not synced:
                return {"synced": None, "plain": lrc_text, "source": "kugou"}
            return {"synced": synced, "plain": None, "source": "kugou"}
    except httpx.HTTPError as exc:
        logger.warning("KuGou request failed: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("KuGou parse failed: %s", exc)
        return None


async def get_lyrics(track_id: str, title: str, artist: str, duration: Optional[int] = None) -> Dict[str, Any]:
    cache_key = md5(f"{track_id}|{title}|{artist}".encode()).hexdigest()
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _TTL:
        return {**cached[1], "cached": True}

    # Clean the title of "(Official Video)", "(Lyrics)" etc. for better matches
    clean_title = re.sub(r"\((?:official.*?|lyrics?.*?|audio.*?|hd.*?|4k.*?)\)", "", title, flags=re.IGNORECASE)
    clean_title = re.sub(r"\[(?:official.*?|lyrics?.*?|audio.*?)\]", "", clean_title, flags=re.IGNORECASE)
    clean_title = clean_title.strip(" -–—")
    clean_artist = artist.split("•")[0].strip() if artist else ""

    result: Optional[Dict[str, Any]] = None
    for candidate_title in [clean_title, title]:
        for candidate_artist in [clean_artist, artist, ""]:
            if not candidate_title:
                continue
            result = await _lrclib(candidate_title, candidate_artist, duration)
            if result:
                break
        if result:
            break

    if not result:
        result = await _kugou(clean_title or title, clean_artist or artist, duration)

    if not result:
        result = {"synced": None, "plain": None, "source": "none"}

    _CACHE[cache_key] = (time.time(), result)
    return {**result, "cached": False}
