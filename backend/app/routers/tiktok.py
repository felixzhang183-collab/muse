"""TikTok OAuth 2.0 flow.

Endpoints:
  GET  /tiktok/auth      — returns the TikTok authorization URL to redirect the user to
  GET  /tiktok/callback  — exchanges the code for tokens and saves them on the user
  GET  /tiktok/status    — returns whether the current user has connected TikTok
  POST /tiktok/disconnect — clears TikTok tokens from the user
"""

import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import get_current_user, get_db
from app.models.user import User

router = APIRouter()

_TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
_TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
_SCOPES = "user.info.basic,video.publish,video.upload,video.list"


@router.get("/auth")
def tiktok_auth_url(current_user: User = Depends(get_current_user)):
    """Return the URL the frontend should redirect the user to."""
    if not settings.tiktok_client_key:
        raise HTTPException(status_code=503, detail="TikTok integration not configured")

    state = secrets.token_urlsafe(16)
    redirect_uri = settings.tiktok_redirect_uri

    params = (
        f"client_key={settings.tiktok_client_key}"
        f"&scope={_SCOPES}"
        f"&response_type=code"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
    )
    return {"data": {"url": f"{_TIKTOK_AUTH_URL}?{params}", "state": state}}


@router.get("/callback")
async def tiktok_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exchange the authorization code for access + refresh tokens."""
    if not settings.tiktok_client_key or not settings.tiktok_client_secret:
        raise HTTPException(status_code=503, detail="TikTok integration not configured")

    redirect_uri = settings.tiktok_redirect_uri
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _TIKTOK_TOKEN_URL,
            data={
                "client_key": settings.tiktok_client_key,
                "client_secret": settings.tiktok_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"TikTok token exchange failed: {resp.text}")

    body = resp.json()
    if body.get("error"):
        raise HTTPException(status_code=400, detail=body.get("error_description", body["error"]))

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=body.get("expires_in", 86400))

    current_user.tiktok_open_id = body["open_id"]
    current_user.tiktok_access_token = body["access_token"]
    current_user.tiktok_refresh_token = body.get("refresh_token")
    current_user.tiktok_token_expires_at = expires_at
    db.commit()

    return {"data": {"connected": True, "open_id": body["open_id"]}}


@router.get("/status")
def tiktok_status(current_user: User = Depends(get_current_user)):
    """Return connection status for the current user."""
    connected = bool(current_user.tiktok_access_token and current_user.tiktok_open_id)
    expired = False
    if connected and current_user.tiktok_token_expires_at:
        expired = current_user.tiktok_token_expires_at < datetime.now(timezone.utc)
    return {
        "data": {
            "connected": connected and not expired,
            "open_id": current_user.tiktok_open_id,
            "expires_at": current_user.tiktok_token_expires_at.isoformat()
            if current_user.tiktok_token_expires_at
            else None,
        }
    }


@router.post("/disconnect")
def tiktok_disconnect(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.tiktok_open_id = None
    current_user.tiktok_access_token = None
    current_user.tiktok_refresh_token = None
    current_user.tiktok_token_expires_at = None
    db.commit()
    return {"data": {"connected": False}}
