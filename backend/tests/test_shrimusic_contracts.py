import os
import uuid

import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


def test_health_and_auth_provider_contracts():
    assert BASE_URL
    client = requests.Session()
    health = client.get(f"{BASE_URL}/api/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"

    email = f"TEST_{uuid.uuid4().hex[:10]}@example.com"
    registered = client.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Testing123", "name": "TEST Listener"},
    )
    assert registered.status_code == 200
    auth = registered.json()
    assert auth["user"]["email"] == email.lower() and auth["session_token"]
    token = auth["session_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = client.get(f"{BASE_URL}/api/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["user_id"] == auth["user"]["user_id"]
    provider = client.get(f"{BASE_URL}/api/profile/provider", headers=headers)
    assert provider.status_code == 200 and provider.json()["connected"] is False
    saved = client.put(
        f"{BASE_URL}/api/profile/provider",
        headers=headers,
        json={"endpoint": "https://music.example.test/", "api_key": "TEST_KEY", "fallback_endpoint": "https://fallback.example.test/"},
    )
    assert saved.status_code == 200 and saved.json()["endpoint"] == "https://music.example.test"
    persisted = client.get(f"{BASE_URL}/api/profile/provider", headers=headers)
    assert persisted.json()["api_key"] == "TEST_KEY" and persisted.json()["connected"] is True
    home = client.get(f"{BASE_URL}/api/music/home", headers=headers)
    assert home.status_code == 200 and isinstance(home.json()["tracks"], list)
    search = client.get(f"{BASE_URL}/api/music/search", params={"q": "test"}, headers=headers)
    assert search.status_code == 200 and search.json()["connected"] is True
    logout = client.post(f"{BASE_URL}/api/auth/logout", headers=headers)
    assert logout.status_code == 200 and logout.json()["success"] is True