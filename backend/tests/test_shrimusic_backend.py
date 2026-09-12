"""ShriMusic backend contract tests (Firebase Auth + YouTube Music).

Covers:
- /api/health
- Firebase REST sign-in -> Bearer flow
- /api/auth/me, /api/auth/register (idempotency 409), /api/auth/sync
- /api/profile/provider (GET + PUT)
- /api/music/home, /api/music/search, /api/music/stream/{video_id}
- /api/library/liked (POST/GET/DELETE)
- /api/library/history (POST/GET)
- /api/library/playlists (GET empty, POST create, GET reflects)
- Auth failure paths (401 without / with bad Bearer)
"""
from __future__ import annotations

import os
import uuid
from typing import Dict

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://music-streaming-dev-1.preview.emergentagent.com",
)
BASE_URL = BASE_URL.rstrip("/")

FIREBASE_WEB_API_KEY = "AIzaSyB0UA_jmus1XNt0JhIB76--XayP32_3lIM"
SEED_EMAIL = "preview.listener@example.com"
SEED_PASSWORD = "ShriMusic@123"


def _firebase_sign_in(email: str, password: str) -> str:
    resp = requests.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": FIREBASE_WEB_API_KEY},
        json={"email": email, "password": password, "returnSecureToken": True},
        timeout=30,
    )
    assert resp.status_code == 200, f"Firebase sign-in failed: {resp.status_code} {resp.text}"
    body = resp.json()
    assert body.get("idToken"), f"No idToken in Firebase response: {body}"
    return body["idToken"]


@pytest.fixture(scope="session")
def id_token() -> str:
    return _firebase_sign_in(SEED_EMAIL, SEED_PASSWORD)


@pytest.fixture(scope="session")
def auth_headers(id_token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {id_token}", "Content-Type": "application/json"}


# ------------------------- Health -------------------------

def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"


# ------------------------- Auth failure paths -------------------------

def test_auth_missing_header_returns_401():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401

def test_auth_invalid_token_returns_401():
    r = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": "Bearer not-a-real-token"},
        timeout=15,
    )
    assert r.status_code == 401


# ------------------------- Auth flows -------------------------

def test_auth_me_returns_user(auth_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"]
    assert body["email"] == SEED_EMAIL
    assert body["name"]


def test_auth_register_new_and_duplicate():
    unique = f"TEST_{uuid.uuid4().hex[:10]}@example.com"
    # Firebase password policy for this project requires a non-alphanumeric char.
    password = "Testing@123"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": unique, "password": password, "name": "TEST User"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Firebase normalizes emails to lowercase; compare case-insensitively.
    assert body["email"].lower() == unique.lower()
    assert body["user_id"]
    assert body["name"] == "TEST User"

    # duplicate registration -> 409
    r2 = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": unique, "password": password, "name": "TEST User"},
        timeout=30,
    )
    assert r2.status_code == 409, f"Expected 409, got {r2.status_code}: {r2.text}"


def test_auth_sync_updates_name(auth_headers):
    r = requests.post(
        f"{BASE_URL}/api/auth/sync",
        headers=auth_headers,
        json={"name": "Preview Listener"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Preview Listener"


# ------------------------- Provider -------------------------

def test_provider_get_and_put(auth_headers):
    r = requests.get(f"{BASE_URL}/api/profile/provider", headers=auth_headers, timeout=20)
    assert r.status_code == 200, r.text
    # note: seeded user may or may not have provider config; assert schema keys
    body = r.json()
    for key in ("endpoint", "api_key", "fallback_endpoint", "connected"):
        assert key in body

    r2 = requests.put(
        f"{BASE_URL}/api/profile/provider",
        headers=auth_headers,
        json={"endpoint": "https://piped.example", "api_key": "", "fallback_endpoint": ""},
        timeout=20,
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["endpoint"] == "https://piped.example"
    assert body2["connected"] is True


# ------------------------- Music -------------------------

def test_music_home_returns_tracks(auth_headers):
    r = requests.get(f"{BASE_URL}/api/music/home", headers=auth_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["tracks"], list)
    assert len(body["tracks"]) > 0, f"Expected >0 tracks in home feed, got {body}"
    t = body["tracks"][0]
    for key in ("id", "title", "artist"):
        assert key in t


@pytest.fixture(scope="session")
def first_search_track(auth_headers):
    r = requests.get(
        f"{BASE_URL}/api/music/search",
        params={"q": "arijit singh"},
        headers=auth_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["tracks"], list)
    assert len(body["tracks"]) >= 1, f"Expected >=1 tracks, got {body}"
    t = body["tracks"][0]
    for key in ("id", "title", "artist"):
        assert key in t and t[key] is not None
    return t


def test_music_search_arijit(first_search_track):
    assert first_search_track["id"]


def test_music_stream_returns_url(auth_headers, first_search_track):
    vid = first_search_track["id"]
    r = requests.get(
        f"{BASE_URL}/api/music/stream/{vid}",
        headers=auth_headers,
        timeout=90,  # yt-dlp can be slow
    )
    assert r.status_code == 200, f"stream failed: {r.status_code} {r.text[:400]}"
    body = r.json()
    assert body.get("stream_url"), f"empty stream_url: {body}"
    dur = body.get("duration_seconds")
    assert dur and dur > 0, f"duration_seconds not > 0: {body}"


# ------------------------- Library: liked -------------------------

def test_library_liked_flow(auth_headers, first_search_track):
    track = {
        "id": first_search_track["id"],
        "title": first_search_track["title"],
        "artist": first_search_track["artist"],
        "art_url": first_search_track.get("art_url"),
    }
    # Add
    r = requests.post(
        f"{BASE_URL}/api/library/liked",
        headers=auth_headers,
        json={"track": track},
        timeout=20,
    )
    assert r.status_code == 200, r.text

    # List should contain it
    r2 = requests.get(f"{BASE_URL}/api/library/liked", headers=auth_headers, timeout=20)
    assert r2.status_code == 200
    ids = [t["id"] for t in r2.json()["tracks"]]
    assert track["id"] in ids

    # Delete
    r3 = requests.delete(
        f"{BASE_URL}/api/library/liked/{track['id']}",
        headers=auth_headers,
        timeout=20,
    )
    assert r3.status_code == 200
    assert r3.json().get("success") is True

    r4 = requests.get(f"{BASE_URL}/api/library/liked", headers=auth_headers, timeout=20)
    ids_after = [t["id"] for t in r4.json()["tracks"]]
    assert track["id"] not in ids_after


# ------------------------- Library: history -------------------------

def test_library_history_flow(auth_headers, first_search_track):
    track = {
        "id": first_search_track["id"],
        "title": first_search_track["title"],
        "artist": first_search_track["artist"],
        "art_url": first_search_track.get("art_url"),
    }
    r = requests.post(
        f"{BASE_URL}/api/library/history",
        headers=auth_headers,
        json={"track": track},
        timeout=20,
    )
    assert r.status_code == 200, r.text

    r2 = requests.get(f"{BASE_URL}/api/library/history", headers=auth_headers, timeout=20)
    assert r2.status_code == 200
    body = r2.json()
    assert isinstance(body["tracks"], list)
    assert len(body["tracks"]) >= 1


# ------------------------- Library: playlists -------------------------

def test_library_playlists_flow(auth_headers):
    r = requests.get(f"{BASE_URL}/api/library/playlists", headers=auth_headers, timeout=20)
    assert r.status_code == 200
    initial = r.json().get("playlists", [])
    initial_names = {p["name"] for p in initial}

    name = f"TEST_Chill_{uuid.uuid4().hex[:6]}"
    r2 = requests.post(
        f"{BASE_URL}/api/library/playlists",
        headers=auth_headers,
        json={"name": name},
        timeout=20,
    )
    assert r2.status_code == 200, r2.text
    created = r2.json()
    assert created["name"] == name
    assert "id" in created

    r3 = requests.get(f"{BASE_URL}/api/library/playlists", headers=auth_headers, timeout=20)
    assert r3.status_code == 200
    names = {p["name"] for p in r3.json().get("playlists", [])}
    assert name in names
    # sanity: at least the new one is present beyond the initial state
    assert name not in initial_names
