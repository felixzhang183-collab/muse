"""
distribute_to_tiktok — Celery task
Phase 5: Distribution

Pipeline:
1. Load Distribution + Render + Song + User from DB
2. Download rendered mp4 from MinIO/R2
3. Crop/letterbox to 9:16 (1080×1920) with moviepy
4. Generate TikTok caption with Claude Sonnet
5. Upload to TikTok Content Posting API v2
6. Update Distribution record with post ID
"""

import logging
import os
import tempfile

import httpx

logger = logging.getLogger(__name__)

_TIKTOK_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/"
_TIKTOK_POST_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"
_TIKTOK_W, _TIKTOK_H = 1080, 1920  # 9:16


def _progress(task_id: str, pct: int, msg: str = "") -> None:
    from app.services.redis_client import set_job_status

    set_job_status(task_id, "running", progress=pct)
    if msg:
        logger.info("[distribute %s] %s", task_id, msg)


def _crop_to_tiktok(input_path: str, output_path: str) -> None:
    """Letterbox a 16:9 video into a 9:16 1080×1920 frame (black bars top/bottom)."""
    import PIL.Image
    if not hasattr(PIL.Image, "ANTIALIAS"):
        PIL.Image.ANTIALIAS = PIL.Image.LANCZOS

    from moviepy.editor import ColorClip, CompositeVideoClip, VideoFileClip

    clip = VideoFileClip(input_path)

    # Scale to fit width=1080 while preserving aspect ratio
    scale = _TIKTOK_W / clip.w
    new_h = int(clip.h * scale)
    clip_resized = clip.resize((_TIKTOK_W, new_h))

    bg = ColorClip((_TIKTOK_W, _TIKTOK_H), color=[0, 0, 0]).set_duration(clip.duration)
    y_pos = (_TIKTOK_H - new_h) // 2

    composed = CompositeVideoClip([bg, clip_resized.set_position(("center", y_pos))])
    composed.write_videofile(
        output_path,
        codec="libx264",
        audio_codec="aac",
        fps=24,
        preset="ultrafast",
        logger=None,
    )
    clip.close()
    composed.close()


def _generate_caption(song, artist_name: str = "Independent Artist") -> str:
    """Ask Claude Sonnet to write a TikTok caption for the song."""
    import anthropic

    from app.config import settings

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    vibe_lines = []
    for attr in ("energy", "warmth", "chaos", "intimacy"):
        val = getattr(song, attr, None)
        if val is not None:
            vibe_lines.append(f"  {attr}: {val:.2f}")
    vibe_text = "\n".join(vibe_lines) if vibe_lines else "  (not available)"

    prompt = f"""You are a music marketing expert writing TikTok captions for an artist.

Artist: {artist_name}
Song: {song.title}
BPM: {round(song.bpm) if song.bpm else "unknown"}
Key: {song.key or "unknown"}
Vibe vector (0–1 scale):
{vibe_text}

Write a TikTok caption that:
1. Opens with a punchy one-line hook that grabs attention (no hashtags yet)
2. Has 2–3 lines of body copy that match the vibe (emotional, evocative)
3. Ends with 6–10 relevant hashtags including #newmusic and the genre/mood

Output ONLY the caption text. No quotes, no explanation."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


def _upload_to_tiktok(video_path: str, caption: str, access_token: str) -> str:
    """Upload video via TikTok Content Posting API v2. Returns publish_id."""
    video_bytes = open(video_path, "rb").read()
    video_size = len(video_bytes)

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }

    # 1. Init upload
    init_body = {
        "post_info": {
            "title": caption[:150],  # TikTok title max 150 chars
            "privacy_level": "PUBLIC_TO_EVERYONE",
            "disable_duet": False,
            "disable_comment": False,
            "disable_stitch": False,
            "video_cover_timestamp_ms": 1000,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": video_size,
            "chunk_size": video_size,
            "total_chunk_count": 1,
        },
    }

    with httpx.Client(timeout=60) as client:
        init_resp = client.post(_TIKTOK_POST_INIT_URL, json=init_body, headers=headers)

    if init_resp.status_code != 200:
        raise RuntimeError(f"TikTok init failed ({init_resp.status_code}): {init_resp.text}")

    init_data = init_resp.json()
    if init_data.get("error", {}).get("code", "ok") != "ok":
        raise RuntimeError(f"TikTok init error: {init_data['error']}")

    upload_url = init_data["data"]["upload_url"]
    publish_id = init_data["data"]["publish_id"]

    # 2. Upload video chunk
    upload_headers = {
        "Content-Type": "video/mp4",
        "Content-Range": f"bytes 0-{video_size - 1}/{video_size}",
        "Content-Length": str(video_size),
    }
    with httpx.Client(timeout=300) as client:
        upload_resp = client.put(upload_url, content=video_bytes, headers=upload_headers)

    if upload_resp.status_code not in (200, 201, 206):
        raise RuntimeError(f"TikTok upload failed ({upload_resp.status_code}): {upload_resp.text}")

    return publish_id


_TIKTOK_PUBLISH_STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/"


def _poll_for_video_id(publish_id: str, access_token: str, timeout: int = 120) -> str | None:
    """Poll TikTok publish status until PUBLISH_COMPLETE; return public video ID or None."""
    import time

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    deadline = time.time() + timeout
    while time.time() < deadline:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                _TIKTOK_PUBLISH_STATUS_URL,
                json={"publish_id": publish_id},
                headers=headers,
            )
        if resp.status_code != 200:
            logger.warning("Publish status check failed: %s", resp.text)
            break
        data = resp.json().get("data", {})
        status = data.get("status", "")
        if status == "PUBLISH_COMPLETE":
            ids = data.get("publicaly_available_post_id", [])
            return ids[0] if ids else None
        if status == "FAILED":
            logger.warning("TikTok publish failed: %s", data)
            return None
        time.sleep(5)
    return None


def distribute_to_tiktok_task(distribution_id: str) -> dict:
    """Core logic — called by the Celery task wrapper below."""
    from app.database import SessionLocal
    from app.models.distribution import Distribution, DistributionStatus
    from app.models.render import Render
    from app.models.song import Song
    from app.models.user import User
    from app.services import storage
    from app.services.redis_client import set_job_status

    db = SessionLocal()
    dist = None
    try:
        dist = db.query(Distribution).filter(Distribution.id == distribution_id).first()
        if not dist:
            raise ValueError(f"Distribution {distribution_id} not found")

        dist.status = DistributionStatus.posting
        db.commit()

        render = db.query(Render).filter(Render.id == dist.render_id).first()
        song = db.query(Song).filter(Song.id == dist.song_id).first()
        user = db.query(User).filter(User.id == dist.user_id).first()

        if not render or not render.render_file_key:
            raise ValueError("Render file not available")
        if not user.tiktok_access_token:
            raise ValueError("TikTok account not connected")

        with tempfile.TemporaryDirectory() as tmpdir:
            # Step 1: download render
            _progress(distribution_id, 10, "Downloading render…")
            video_bytes = storage.download_file(render.render_file_key)
            src_path = os.path.join(tmpdir, "render.mp4")
            with open(src_path, "wb") as f:
                f.write(video_bytes)

            # Step 2: crop to 9:16
            _progress(distribution_id, 30, "Converting to 9:16…")
            tiktok_path = os.path.join(tmpdir, "tiktok.mp4")
            _crop_to_tiktok(src_path, tiktok_path)

            # Step 3: generate caption
            _progress(distribution_id, 60, "Writing caption…")
            caption = _generate_caption(song, user.artist_name)
            dist.caption = caption
            db.commit()

            # Step 4: upload to TikTok
            _progress(distribution_id, 75, "Uploading to TikTok…")
            publish_id = _upload_to_tiktok(tiktok_path, caption, user.tiktok_access_token)

        # Step 5: poll for real video ID (TikTok needs time to process)
        _progress(distribution_id, 88, "Waiting for TikTok to publish…")
        video_id = _poll_for_video_id(publish_id, user.tiktok_access_token)

        dist.platform_post_id = video_id or publish_id  # fall back to publish_id if polling times out
        dist.status = DistributionStatus.posted
        db.commit()

        set_job_status(distribution_id, "complete", progress=100, result={"video_id": dist.platform_post_id})
        return {"video_id": dist.platform_post_id}

    except Exception as exc:
        logger.exception("distribute_to_tiktok failed for %s", distribution_id)
        if dist is not None:
            dist.status = DistributionStatus.error
            dist.error_message = str(exc)
            db.commit()
        set_job_status(distribution_id, "failed", error=str(exc))
        raise
    finally:
        db.close()


# ── Celery task wrapper ──────────────────────────────────────────────────────

from app.workers.celery_app import celery_app  # noqa: E402


@celery_app.task(
    name="app.workers.tasks.distribute.distribute_to_tiktok",
    bind=True,
    max_retries=0,
    time_limit=600,
)
def distribute_to_tiktok(self, distribution_id: str) -> dict:
    return distribute_to_tiktok_task(distribution_id)
