import json

import redis

from app.config import settings

_pool = redis.ConnectionPool.from_url(settings.redis_url, decode_responses=True)


def get_redis() -> redis.Redis:
    return redis.Redis(connection_pool=_pool)


# ─── Job status helpers ───────────────────────────────────────────────────────
# Jobs are stored as JSON under key "job:{task_id}" with a 24-hour TTL.


def set_job_status(
    task_id: str,
    status: str,
    progress: int = 0,
    error: str | None = None,
    result: dict | None = None,
) -> None:
    r = get_redis()
    r.setex(
        f"job:{task_id}",
        86400,  # 24h TTL
        json.dumps(
            {"job_id": task_id, "status": status, "progress": progress, "error": error, "result": result}
        ),
    )


def get_job_status(task_id: str) -> dict | None:
    r = get_redis()
    raw = r.get(f"job:{task_id}")
    return json.loads(raw) if raw else None
