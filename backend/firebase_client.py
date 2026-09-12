"""Firebase Admin SDK bootstrap for ShriMusic."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, firestore
from google.cloud.firestore import Client


logger = logging.getLogger("shrimusic.firebase")

_CRED_PATH = os.environ.get("FIREBASE_CREDENTIALS_PATH", "/app/backend/firebase-admin.json")

if not firebase_admin._apps:
    cred = credentials.Certificate(_CRED_PATH)
    firebase_admin.initialize_app(cred, {"projectId": os.environ.get("FIREBASE_PROJECT_ID", "shrimusic")})
    logger.info("Firebase Admin SDK initialized for project: %s", os.environ.get("FIREBASE_PROJECT_ID"))


def db() -> Client:
    return firestore.client()


def verify_id_token(token: str) -> Dict[str, Any]:
    """Verify a Firebase ID token. Raises firebase_admin.auth exceptions on failure."""
    # check_revoked=False keeps this fast; ID tokens auto-expire in 1 hour
    return fb_auth.verify_id_token(token, check_revoked=False)


def get_user(uid: str) -> Optional[fb_auth.UserRecord]:
    try:
        return fb_auth.get_user(uid)
    except fb_auth.UserNotFoundError:
        return None


def create_user(email: str, password: str, display_name: Optional[str] = None) -> fb_auth.UserRecord:
    return fb_auth.create_user(email=email, password=password, display_name=display_name)


def upsert_profile(uid: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Store/merge a public profile document at users/{uid}."""
    ref = db().collection("users").document(uid)
    ref.set(data, merge=True)
    snap = ref.get()
    return snap.to_dict() or {}
