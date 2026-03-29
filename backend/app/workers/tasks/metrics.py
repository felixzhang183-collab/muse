"""
sync_tiktok_metrics — Celery Beat task
Phase 6: Analytics Feedback Loop

Runs hourly. For each posted distribution with a video ID, fetches current
view/like/share/comment counts from the TikTok Video Query API and stores them.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

_TIKTOK_VIDEO_QUERY_URL = "https://open.tiktokapis.com/v2/video/query/"
_TIKTOK_VIDEO_FIELDS = "id,title,view_count,like_count,comment_count,share_count"


def _fetch_video_metrics(video_ids: list[str], access_token: str) -> dict[str, dict]:
    """Return {video_id: {view_count, like_count, share_count, comment_count}} from TikTok."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
    }
    body = {"filters": {"video_ids": video_ids}, "fields": _TIKTOK_VIDEO_FIELDS}

    with httpx.Client(timeout=30) as client:
        resp = client.post(f"{_TIKTOK_VIDEO_QUERY_URL}?fields={_TIKTOK_VIDEO_FIELDS}", json=body, headers=headers)

    if resp.status_code != 200:
        logger.warning("TikTok video query failed (%s): %s", resp.status_code, resp.text[:200])
        return {}

    data = resp.json()
    if data.get("error", {}).get("code", "ok") != "ok":
        logger.warning("TikTok API error: %s", data.get("error"))
        return {}

    result = {}
    for item in data.get("data", {}).get("videos", []):
        result[item["id"]] = {
            "view_count": item.get("view_count"),
            "like_count": item.get("like_count"),
            "share_count": item.get("share_count"),
            "comment_count": item.get("comment_count"),
        }
    return result


def sync_tiktok_metrics_task() -> dict:
    """Sync metrics for all posted TikTok distributions that have a video ID."""
    from datetime import datetime, timezone

    from app.database import SessionLocal
    from app.models.distribution import Distribution, DistributionStatus
    from app.models.user import User

    db = SessionLocal()
    updated = 0
    errors = 0

    try:
        # Group distributions by user so we make one API call per user
        distributions = (
            db.query(Distribution)
            .filter(
                Distribution.status == DistributionStatus.posted,
                Distribution.platform == "tiktok",
                Distribution.platform_post_id.isnot(None),
            )
            .all()
        )

        # Group by user_id
        by_user: dict[str, list[Distribution]] = {}
        for dist in distributions:
            by_user.setdefault(dist.user_id, []).append(dist)

        for user_id, user_dists in by_user.items():
            user = db.query(User).filter(User.id == user_id).first()
            if not user or not user.tiktok_access_token:
                continue

            video_ids = [d.platform_post_id for d in user_dists if d.platform_post_id]
            if not video_ids:
                continue

            # TikTok API accepts up to 20 IDs per request
            for chunk_start in range(0, len(video_ids), 20):
                chunk_ids = video_ids[chunk_start : chunk_start + 20]
                try:
                    metrics = _fetch_video_metrics(chunk_ids, user.tiktok_access_token)
                except Exception as e:
                    logger.warning("Metrics fetch failed for user %s: %s", user_id, e)
                    errors += 1
                    continue

                now = datetime.now(timezone.utc)
                for dist in user_dists:
                    if dist.platform_post_id in metrics:
                        m = metrics[dist.platform_post_id]
                        dist.view_count = m.get("view_count")
                        dist.like_count = m.get("like_count")
                        dist.share_count = m.get("share_count")
                        dist.comment_count = m.get("comment_count")
                        dist.metrics_fetched_at = now
                        updated += 1

        db.commit()
        logger.info("sync_tiktok_metrics: updated=%d errors=%d", updated, errors)
        return {"updated": updated, "errors": errors}

    except Exception:
        logger.exception("sync_tiktok_metrics task failed")
        raise
    finally:
        db.close()


# ── Celery task wrapper ──────────────────────────────────────────────────────

from app.workers.celery_app import celery_app  # noqa: E402


@celery_app.task(
    name="app.workers.tasks.metrics.sync_tiktok_metrics",
    max_retries=0,
    time_limit=300,
)
def sync_tiktok_metrics() -> dict:
    return sync_tiktok_metrics_task()
