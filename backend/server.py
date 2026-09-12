from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from firebase_admin import auth as fb_auth
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Firebase must import AFTER env is loaded.
from firebase_client import create_user, db, upsert_profile, verify_id_token  # noqa: E402
from youtube_client import get_stream, home_feed, search_tracks  # noqa: E402


logger = logging.getLogger("shrimusic")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="ShriMusic API")
api_router = APIRouter(prefix="/api")


# ---------- Schemas ----------


class UserResponse(BaseModel):
    user_id: str
    email: EmailStr
    name: str
    picture: Optional[str] = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=2, max_length=80)


class SyncRequest(BaseModel):
    name: Optional[str] = None
    picture: Optional[str] = None


class ProviderConfig(BaseModel):
    endpoint: str = ""
    api_key: str = ""
    fallback_endpoint: str = ""


class ProviderResponse(ProviderConfig):
    connected: bool


class Track(BaseModel):
    id: str
    title: str
    artist: str
    art_url: Optional[str] = None
    stream_url: Optional[str] = None
    duration_seconds: Optional[int] = None


class TrackFeed(BaseModel):
    tracks: List[Track]
    message: Optional[str] = None


class LikeRequest(BaseModel):
    track: Track


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PlaylistAddTrack(BaseModel):
    track: Track


class HistoryRecord(BaseModel):
    track: Track


# ---------- Helpers ----------


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        decoded = verify_id_token(token)
    except Exception as exc:  # firebase raises different subclasses; treat all as auth failure
        logger.info("Token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Session expired") from exc
    return decoded


def user_response(uid: str, decoded: Dict[str, Any], profile: Optional[Dict[str, Any]] = None) -> UserResponse:
    profile = profile or {}
    return UserResponse(
        user_id=uid,
        email=profile.get("email") or decoded.get("email"),
        name=profile.get("name") or decoded.get("name") or (decoded.get("email") or "listener").split("@")[0],
        picture=profile.get("picture") or decoded.get("picture"),
    )


# ---------- Auth ----------


@api_router.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "shrimusic"}


@api_router.post("/auth/register", response_model=UserResponse)
async def register(payload: RegisterRequest) -> UserResponse:
    """Create a Firebase Auth user, then materialize the profile in Firestore.

    The client should immediately sign in with the same credentials to obtain
    a Firebase ID token.
    """
    try:
        record = create_user(email=payload.email, password=payload.password, display_name=payload.name.strip())
    except fb_auth.EmailAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail="An account already exists for this email") from exc
    except Exception as exc:
        logger.warning("register failed: %s", exc)
        message = str(exc)
        detail = "Could not create account"
        if "PASSWORD_DOES_NOT_MEET_REQUIREMENTS" in message:
            detail = "Password needs at least one number and one symbol."
        elif "WEAK_PASSWORD" in message:
            detail = "Password is too weak. Use at least 6 characters."
        elif "INVALID_EMAIL" in message:
            detail = "That email address doesn't look right."
        raise HTTPException(status_code=400, detail=detail) from exc

    profile = {
        "email": record.email,
        "name": payload.name.strip(),
        "picture": None,
        "created_at": now_utc(),
    }
    upsert_profile(record.uid, profile)
    return UserResponse(user_id=record.uid, email=record.email, name=profile["name"], picture=None)


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(decoded: Dict[str, Any] = Depends(current_user)) -> UserResponse:
    uid = decoded["uid"]
    snap = db().collection("users").document(uid).get()
    profile = snap.to_dict() if snap.exists else None
    if not profile:
        # First login via Firebase Auth (e.g. Google) — bootstrap profile.
        profile = {
            "email": decoded.get("email"),
            "name": decoded.get("name") or (decoded.get("email") or "listener").split("@")[0],
            "picture": decoded.get("picture"),
            "created_at": now_utc(),
        }
        upsert_profile(uid, profile)
    return user_response(uid, decoded, profile)


@api_router.post("/auth/sync", response_model=UserResponse)
async def sync_profile(payload: SyncRequest, decoded: Dict[str, Any] = Depends(current_user)) -> UserResponse:
    uid = decoded["uid"]
    update: Dict[str, Any] = {"email": decoded.get("email"), "updated_at": now_utc()}
    if payload.name:
        update["name"] = payload.name.strip()
    if payload.picture is not None:
        update["picture"] = payload.picture
    if "name" not in update:
        update.setdefault("name", decoded.get("name") or (decoded.get("email") or "listener").split("@")[0])
    profile = upsert_profile(uid, update)
    return user_response(uid, decoded, profile)


# ---------- Provider config ----------


@api_router.get("/profile/provider", response_model=ProviderResponse)
async def get_provider(decoded: Dict[str, Any] = Depends(current_user)) -> ProviderResponse:
    uid = decoded["uid"]
    snap = db().collection("users").document(uid).collection("meta").document("provider").get()
    data = snap.to_dict() if snap.exists else {}
    return ProviderResponse(
        endpoint=data.get("endpoint", ""),
        api_key=data.get("api_key", ""),
        fallback_endpoint=data.get("fallback_endpoint", ""),
        connected=bool(data.get("endpoint")),
    )


@api_router.put("/profile/provider", response_model=ProviderResponse)
async def save_provider(payload: ProviderConfig, decoded: Dict[str, Any] = Depends(current_user)) -> ProviderResponse:
    uid = decoded["uid"]
    values = {
        "endpoint": payload.endpoint.strip().rstrip("/"),
        "api_key": payload.api_key.strip(),
        "fallback_endpoint": payload.fallback_endpoint.strip().rstrip("/"),
        "updated_at": now_utc(),
    }
    db().collection("users").document(uid).collection("meta").document("provider").set(values, merge=True)
    return ProviderResponse(
        endpoint=values["endpoint"],
        api_key=values["api_key"],
        fallback_endpoint=values["fallback_endpoint"],
        connected=bool(values["endpoint"]),
    )


# ---------- Music (YouTube) ----------


@api_router.get("/music/home", response_model=TrackFeed)
async def home(decoded: Dict[str, Any] = Depends(current_user)) -> TrackFeed:
    tracks = await home_feed(limit=24)
    message = None if tracks else "YouTube Music is unreachable right now. Try again in a moment."
    return TrackFeed(tracks=[Track(**t) for t in tracks], message=message)


@api_router.get("/music/search", response_model=TrackFeed)
async def search(q: str = Query(min_length=1, max_length=120), decoded: Dict[str, Any] = Depends(current_user)) -> TrackFeed:
    tracks = await search_tracks(q, limit=25)
    message = None if tracks else f"No results found for {q!r}."
    return TrackFeed(tracks=[Track(**t) for t in tracks], message=message)


@api_router.get("/music/stream/{video_id}", response_model=Track)
async def stream(video_id: str, decoded: Dict[str, Any] = Depends(current_user)) -> Track:
    result = await get_stream(video_id)
    if not result:
        raise HTTPException(status_code=404, detail="This track can't be streamed right now")
    return Track(**result)


# ---------- Library: liked songs ----------


@api_router.get("/library/liked", response_model=TrackFeed)
async def list_liked(decoded: Dict[str, Any] = Depends(current_user)) -> TrackFeed:
    uid = decoded["uid"]
    docs = (
        db()
        .collection("users")
        .document(uid)
        .collection("liked_songs")
        .order_by("liked_at", direction="DESCENDING")
        .limit(100)
        .stream()
    )
    tracks = []
    for doc in docs:
        data = doc.to_dict() or {}
        tracks.append(Track(id=doc.id, title=data.get("title", ""), artist=data.get("artist", ""), art_url=data.get("art_url")))
    return TrackFeed(tracks=tracks)


@api_router.post("/library/liked", response_model=Track)
async def add_liked(payload: LikeRequest, decoded: Dict[str, Any] = Depends(current_user)) -> Track:
    uid = decoded["uid"]
    ref = db().collection("users").document(uid).collection("liked_songs").document(payload.track.id)
    ref.set(
        {
            "title": payload.track.title,
            "artist": payload.track.artist,
            "art_url": payload.track.art_url,
            "liked_at": now_utc(),
        },
        merge=True,
    )
    return payload.track


@api_router.delete("/library/liked/{track_id}")
async def remove_liked(track_id: str, decoded: Dict[str, Any] = Depends(current_user)) -> Dict[str, bool]:
    uid = decoded["uid"]
    db().collection("users").document(uid).collection("liked_songs").document(track_id).delete()
    return {"success": True}


# ---------- Library: playlists ----------


@api_router.get("/library/playlists")
async def list_playlists(decoded: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    uid = decoded["uid"]
    docs = (
        db()
        .collection("users")
        .document(uid)
        .collection("playlists")
        .order_by("created_at", direction="DESCENDING")
        .stream()
    )
    playlists = []
    for doc in docs:
        data = doc.to_dict() or {}
        playlists.append({"id": doc.id, "name": data.get("name", ""), "track_count": data.get("track_count", 0)})
    return {"playlists": playlists}


@api_router.post("/library/playlists")
async def create_playlist(payload: PlaylistCreate, decoded: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    uid = decoded["uid"]
    ref = db().collection("users").document(uid).collection("playlists").document()
    ref.set({"name": payload.name.strip(), "track_count": 0, "created_at": now_utc()})
    return {"id": ref.id, "name": payload.name.strip(), "track_count": 0}


@api_router.post("/library/playlists/{playlist_id}/tracks", response_model=Track)
async def add_track_to_playlist(playlist_id: str, payload: PlaylistAddTrack, decoded: Dict[str, Any] = Depends(current_user)) -> Track:
    uid = decoded["uid"]
    base = db().collection("users").document(uid).collection("playlists").document(playlist_id)
    if not base.get().exists:
        raise HTTPException(status_code=404, detail="Playlist not found")
    base.collection("tracks").document(payload.track.id).set(
        {
            "title": payload.track.title,
            "artist": payload.track.artist,
            "art_url": payload.track.art_url,
            "added_at": now_utc(),
        },
        merge=True,
    )
    # naive increment
    snap = base.get().to_dict() or {}
    base.set({"track_count": (snap.get("track_count", 0) or 0) + 1}, merge=True)
    return payload.track


# ---------- Library: history ----------


@api_router.get("/library/history", response_model=TrackFeed)
async def list_history(decoded: Dict[str, Any] = Depends(current_user)) -> TrackFeed:
    uid = decoded["uid"]
    docs = (
        db()
        .collection("users")
        .document(uid)
        .collection("history")
        .order_by("played_at", direction="DESCENDING")
        .limit(50)
        .stream()
    )
    tracks = []
    for doc in docs:
        data = doc.to_dict() or {}
        tracks.append(Track(id=data.get("track_id", doc.id), title=data.get("title", ""), artist=data.get("artist", ""), art_url=data.get("art_url")))
    return TrackFeed(tracks=tracks)


@api_router.post("/library/history", response_model=Track)
async def record_history(payload: HistoryRecord, decoded: Dict[str, Any] = Depends(current_user)) -> Track:
    uid = decoded["uid"]
    db().collection("users").document(uid).collection("history").add(
        {
            "track_id": payload.track.id,
            "title": payload.track.title,
            "artist": payload.track.artist,
            "art_url": payload.track.art_url,
            "played_at": now_utc(),
        }
    )
    return payload.track


# ---------- Wire up ----------


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    # Seed a test account so testing agents can log in without external steps.
    email = "preview.listener@example.com"
    try:
        try:
            user = fb_auth.get_user_by_email(email)
        except fb_auth.UserNotFoundError:
            user = create_user(email=email, password="ShriMusic@123", display_name="Preview Listener")
            logger.info("Seeded test user: %s (uid=%s)", email, user.uid)
        upsert_profile(user.uid, {"email": email, "name": "Preview Listener", "picture": None})
    except Exception as exc:  # non-fatal
        logger.warning("Test user seeding skipped: %s", exc)
