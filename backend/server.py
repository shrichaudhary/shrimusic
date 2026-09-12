from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
import secrets
from typing import Any, Dict, List, Optional
import uuid

import bcrypt
import httpx
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "shrimusic-development-secret")
JWT_ALGORITHM = "HS256"
SESSION_DAYS = 7

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
app = FastAPI(title="ShriMusic API")
api_router = APIRouter(prefix="/api")
logger = logging.getLogger("shrimusic")


class UserResponse(BaseModel):
    user_id: str
    email: EmailStr
    name: str
    picture: Optional[str] = None


class AuthResponse(BaseModel):
    session_token: str
    user: UserResponse


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(Credentials):
    name: str = Field(min_length=2, max_length=80)


class SessionRequest(BaseModel):
    session_id: str = Field(min_length=8)


class ProviderConfig(BaseModel):
    endpoint: str = ""
    api_key: str = ""
    fallback_endpoint: str = ""


class ProviderResponse(ProviderConfig):
    connected: bool


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def user_response(doc: Dict[str, Any]) -> UserResponse:
    return UserResponse(
        user_id=doc["user_id"],
        email=doc["email"],
        name=doc.get("name") or doc["email"].split("@")[0],
        picture=doc.get("picture"),
    )


async def create_session(user_id: str) -> str:
    session_token = secrets.token_urlsafe(40)
    created_at = now_utc()
    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "created_at": created_at,
            "expires_at": created_at + timedelta(days=SESSION_DAYS),
        }
    )
    return session_token


async def current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    session = await db.user_sessions.find_one(
        {"session_token": token},
        {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=401, detail="Session expired")
    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.provider_configs.create_index("user_id", unique=True)


@api_router.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok", "service": "shrimusic"}


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest) -> AuthResponse:
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="An account already exists for this email")
    user_doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "name": payload.name.strip(),
        "picture": None,
        "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    token = await create_session(user_doc["user_id"])
    return AuthResponse(session_token=token, user=user_response(user_doc))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: Credentials) -> AuthResponse:
    user_doc = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not user_doc or not user_doc.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(payload.password.encode(), user_doc["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = await create_session(user_doc["user_id"])
    return AuthResponse(session_token=token, user=user_response(user_doc))


@api_router.post("/auth/session", response_model=AuthResponse)
async def exchange_google_session(payload: SessionRequest) -> AuthResponse:
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            response = await http_client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_id},
            )
    except httpx.HTTPError as exc:
        logger.warning("Google session exchange failed: %s", exc)
        raise HTTPException(status_code=401, detail="Google sign-in is unavailable") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Google sign-in session expired")
    data = response.json()
    email = str(data.get("email", "")).lower()
    if not email or not data.get("session_token"):
        raise HTTPException(status_code=401, detail="Google profile was incomplete")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_doc = existing
        await db.users.update_one(
            {"user_id": user_doc["user_id"]},
            {"$set": {"name": data.get("name") or user_doc.get("name"), "picture": data.get("picture")}},
        )
        user_doc = {**user_doc, "name": data.get("name") or user_doc.get("name"), "picture": data.get("picture")}
    else:
        user_doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture"),
            "created_at": now_utc(),
        }
        await db.users.insert_one(user_doc)
    token = await create_session(user_doc["user_id"])
    return AuthResponse(session_token=token, user=user_response(user_doc))


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user: Dict[str, Any] = Depends(current_user)) -> UserResponse:
    return user_response(user)


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)) -> Dict[str, bool]:
    if authorization and authorization.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": authorization.removeprefix("Bearer ").strip()})
    return {"success": True}


@api_router.get("/profile/provider", response_model=ProviderResponse)
async def get_provider(user: Dict[str, Any] = Depends(current_user)) -> ProviderResponse:
    config = await db.provider_configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not config:
        return ProviderResponse(connected=False)
    return ProviderResponse(
        endpoint=config.get("endpoint", ""),
        api_key=config.get("api_key", ""),
        fallback_endpoint=config.get("fallback_endpoint", ""),
        connected=bool(config.get("endpoint")),
    )


@api_router.put("/profile/provider", response_model=ProviderResponse)
async def save_provider(payload: ProviderConfig, user: Dict[str, Any] = Depends(current_user)) -> ProviderResponse:
    values = {
        "user_id": user["user_id"],
        "endpoint": payload.endpoint.strip().rstrip("/"),
        "api_key": payload.api_key.strip(),
        "fallback_endpoint": payload.fallback_endpoint.strip().rstrip("/"),
        "updated_at": now_utc(),
    }
    await db.provider_configs.update_one({"user_id": user["user_id"]}, {"$set": values}, upsert=True)
    return ProviderResponse(
        endpoint=values["endpoint"],
        api_key=values["api_key"],
        fallback_endpoint=values["fallback_endpoint"],
        connected=bool(values["endpoint"]),
    )


@api_router.get("/music/home")
async def home(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    config = await db.provider_configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    connected = bool(config and config.get("endpoint"))
    return {
        "connected": connected,
        "tracks": [],
        "message": "Your provider is ready. Search and playback will appear here when its adapter is connected." if connected else "Connect an Invidious or Piped endpoint to start discovering music.",
    }


@api_router.get("/music/search")
async def search(q: str = Query(min_length=1, max_length=120), user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    config = await db.provider_configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not config or not config.get("endpoint"):
        return {"connected": False, "tracks": [], "message": "Connect a provider in Settings to search."}
    return {"connected": True, "tracks": [], "message": f"Provider connected. Search adapter will query for {q!r}."}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_db_client() -> None:
    await ensure_indexes()


@app.on_event("shutdown")
async def shutdown_db_client() -> None:
    client.close()