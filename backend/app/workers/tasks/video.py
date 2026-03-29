"""
analyze_video — Celery task

1. Download 4 YouTube thumbnail frames (no video download needed)
2. Send frames to GPT-4o Vision → visual vibe vector + mood description + color palette
3. Upsert 4D vibe vector to Qdrant
4. Write results to `videos` table
"""

import base64
import json
import logging
import re
import uuid

import httpx

logger = logging.getLogger(__name__)

# YouTube provides predictable frame thumbnails at 25/50/75% of the video
_YOUTUBE_THUMBNAIL_TEMPLATES = [
    "https://img.youtube.com/vi/{id}/hqdefault.jpg",
    "https://img.youtube.com/vi/{id}/1.jpg",
    "https://img.youtube.com/vi/{id}/2.jpg",
    "https://img.youtube.com/vi/{id}/3.jpg",
]

_REFUSAL_RE = re.compile(
    r"(i\s*(?:can('|no)t|cannot)\s+assist\s+with\s+that|i[' ]?m\s+sorry[, ]|cannot\s+help\s+with\s+that)",
    re.IGNORECASE,
)


def _neutral_analysis() -> dict:
    return {
        "visual_energy": 0.5,
        "visual_warmth": 0.5,
        "visual_chaos": 0.5,
        "visual_intimacy": 0.5,
        "visual_mood": "Neutral visual style (AI analysis unavailable).",
        "color_palette": ["#808080", "#B0B0B0", "#404040"],
    }


def _fetch_thumbnails(platform: str, video_id: str, thumbnail_url: str) -> list[str]:
    """Download thumbnail images and return as base64 strings.

    YouTube: fetches up to 4 CDN frames.
    TikTok (and others): fetches the stored thumbnail_url only.
    """
    urls: list[str]
    if platform == "youtube":
        urls = [tmpl.format(id=video_id) for tmpl in _YOUTUBE_THUMBNAIL_TEMPLATES]
    else:
        urls = [thumbnail_url] if thumbnail_url else []

    result = []
    with httpx.Client(timeout=10) as client:
        for url in urls:
            try:
                resp = client.get(url)
                # Skip tiny error-placeholder images (YouTube's 404 thumbnails are ~2KB)
                if resp.status_code == 200 and len(resp.content) > 5_000:
                    result.append(base64.b64encode(resp.content).decode())
            except Exception:
                pass
    return result[:4]


def _analyze_with_gpt4o(youtube_id: str, title: str, frames_b64: list[str]) -> dict:
    """Send thumbnail frames to GPT-4o Vision and parse the visual vibe JSON."""
    from openai import OpenAI
    from app.config import settings

    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    client = OpenAI(api_key=settings.openai_api_key)

    content: list[dict] = [
        {
            "type": "text",
            "text": (
                f'Analyze these video frames from a video titled "{title}".\n\n'
                "Score the visual aesthetics on 4 axes (0.0–1.0):\n"
                "- visual_energy: visual intensity, motion cues, brightness/contrast (0=calm/static, 1=intense/dynamic)\n"
                "- visual_warmth: color temperature (0=cold blues/greens, 1=warm reds/oranges/golds)\n"
                "- visual_chaos: visual busyness, clutter, complexity (0=minimal/clean, 1=chaotic/dense)\n"
                "- visual_intimacy: closeness, personal scale (0=epic/wide/grand, 1=close-up/personal/intimate)\n\n"
                "Also provide:\n"
                "- visual_mood: 1–2 sentence description of the overall visual mood and aesthetic\n"
                "- color_palette: list of 3–5 dominant hex color codes\n\n"
                "Respond with ONLY valid JSON, no explanation:\n"
                '{"visual_energy": 0.0, "visual_warmth": 0.0, "visual_chaos": 0.0, '
                '"visual_intimacy": 0.0, "visual_mood": "...", "color_palette": ["#..."]}'
            ),
        }
    ]

    for b64 in frames_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
        })

    # First pass: strict JSON mode.
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=300,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": content}],
    )

    raw = (response.choices[0].message.content or "").strip()
    logger.info("GPT-4o vision response for %s: %r", youtube_id, raw[:300])
    if not raw:
        logger.warning("GPT vision empty response for %s; using neutral fallback", youtube_id)
        return _neutral_analysis()

    if _REFUSAL_RE.search(raw):
        # Retry once with a smaller model and a harder JSON-only instruction.
        content[0]["text"] += (
            "\n\nIMPORTANT: Return ONLY a JSON object with those exact keys. "
            "Do not return any refusal text or commentary."
        )
        response2 = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=300,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": content}],
        )
        raw = (response2.choices[0].message.content or "").strip()
        logger.info("GPT-4o-mini retry response for %s: %r", youtube_id, raw[:300])
        if not raw:
            logger.warning("GPT vision empty retry response for %s; using neutral fallback", youtube_id)
            return _neutral_analysis()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[^{}]*\}", raw)  # first complete flat object
        if not match:
            if _REFUSAL_RE.search(raw):
                logger.warning("GPT vision refused for %s; using neutral fallback", youtube_id)
                return _neutral_analysis()
            if not raw.strip():
                logger.warning("GPT vision blank non-JSON response for %s; using neutral fallback", youtube_id)
                return _neutral_analysis()
            raise ValueError(f"Could not parse GPT-4o response: {raw[:200]}")
        parsed = json.loads(match.group())

    # Validate and coerce shape.
    def _num(key: str, default: float = 0.5) -> float:
        try:
            v = float(parsed.get(key, default))
        except Exception:
            v = default
        return max(0.0, min(1.0, v))

    palette = parsed.get("color_palette") or []
    if not isinstance(palette, list):
        palette = []
    palette = [str(c).strip() for c in palette if isinstance(c, str) and str(c).strip()][:5]
    if not palette:
        palette = ["#808080", "#B0B0B0", "#404040"]

    mood = str(parsed.get("visual_mood", "") or "").strip()
    if not mood:
        mood = "Atmospheric visuals."

    return {
        "visual_energy": _num("visual_energy"),
        "visual_warmth": _num("visual_warmth"),
        "visual_chaos": _num("visual_chaos"),
        "visual_intimacy": _num("visual_intimacy"),
        "visual_mood": mood,
        "color_palette": palette,
    }


from app.workers.celery_app import celery_app  # noqa: E402


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def analyze_video(self, video_id: str) -> dict:
    """
    1. Fetch thumbnail frames from YouTube
    2. Analyze with GPT-4o Vision → visual vibe vector
    3. Upsert to Qdrant
    4. Write results to DB
    """
    import numpy as np

    from app.database import SessionLocal
    from app.models.video import Video, VideoStatus
    from app.services import qdrant as qdrant_svc
    from app.services.redis_client import set_job_status

    task_id = self.request.id
    set_job_status(task_id, "running", progress=0)

    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == video_id).first()
        if not video:
            set_job_status(task_id, "failed", error="Video record not found")
            return {"error": "Video not found"}

        # ── 1. Fetch thumbnail frames ─────────────────────────────────
        set_job_status(task_id, "running", progress=20)
        frames = _fetch_thumbnails(
            getattr(video, "platform", "youtube"),
            video.youtube_id,
            video.thumbnail_url or "",
        )
        if not frames:
            raise RuntimeError(f"Could not fetch thumbnails for {video.youtube_id}")
        logger.info("Fetched %d thumbnail frames for %s", len(frames), video.youtube_id)

        # ── 2. GPT-4o Vision analysis ─────────────────────────────────
        set_job_status(task_id, "running", progress=50)
        analysis = _analyze_with_gpt4o(video.youtube_id, video.title, frames)

        # ── 3. Upsert to Qdrant (clean up stale point first) ─────────
        set_job_status(task_id, "running", progress=80)
        qdrant_id = None
        vibe = [
            float(np.clip(analysis["visual_energy"], 0, 1)),
            float(np.clip(analysis["visual_warmth"], 0, 1)),
            float(np.clip(analysis["visual_chaos"], 0, 1)),
            float(np.clip(analysis["visual_intimacy"], 0, 1)),
        ]
        try:
            if video.qdrant_id:
                try:
                    qdrant_svc.delete_video(video.qdrant_id)
                except Exception:
                    pass  # stale point missing is fine
            qdrant_id = str(uuid.uuid4())
            qdrant_svc.init_collection()
            from app.models.aesthetic import AestheticVideo
            aesthetic_ids = [
                row.aesthetic_id
                for row in db.query(AestheticVideo).filter(AestheticVideo.video_id == video.id).all()
            ]
            qdrant_svc.upsert_video(
                qdrant_id,
                vibe,
                {
                    "video_id": video.id,
                    "youtube_id": video.youtube_id,
                    "title": video.title,
                    "aesthetic_ids": aesthetic_ids,
                },
            )
        except Exception as qerr:
            logger.warning("Qdrant unavailable while indexing %s: %s", video.id, qerr)
            qdrant_id = None

        # ── 4. Write to DB ────────────────────────────────────────────
        video.visual_energy = vibe[0]
        video.visual_warmth = vibe[1]
        video.visual_chaos = vibe[2]
        video.visual_intimacy = vibe[3]
        video.visual_mood = analysis.get("visual_mood", "")
        video.color_palette = analysis.get("color_palette", [])
        video.qdrant_id = qdrant_id
        video.status = VideoStatus.analyzed
        db.commit()

        result = {
            "video_id": video_id,
            "youtube_id": video.youtube_id,
            "visual_energy": vibe[0],
            "visual_warmth": vibe[1],
            "visual_chaos": vibe[2],
            "visual_intimacy": vibe[3],
        }
        set_job_status(task_id, "complete", progress=100, result=result)
        logger.info(
            "analyze_video complete: %s (%s) — energy=%.2f warmth=%.2f chaos=%.2f intimacy=%.2f",
            video_id, video.youtube_id, *vibe,
        )
        return result

    except Exception as exc:
        logger.exception("analyze_video failed for %s", video_id)
        try:
            video = db.query(Video).filter(Video.id == video_id).first()
            if video:
                video.status = VideoStatus.error
                video.error_message = str(exc)
                db.commit()
        except Exception:
            pass
        set_job_status(task_id, "failed", error=str(exc))
        raise self.retry(exc=exc)

    finally:
        db.close()
