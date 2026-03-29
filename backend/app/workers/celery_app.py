from celery import Celery

from app.config import settings
import app.models  # noqa: F401 — registers all SQLAlchemy models before any task runs

celery_app = Celery(
    "musicapp",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.workers.tasks.audio",
        "app.workers.tasks.video",
        "app.workers.tasks.render",
        "app.workers.tasks.distribute",
        "app.workers.tasks.metrics",
        "app.workers.tasks.lyrics",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,           # re-queue if worker dies mid-task
    worker_prefetch_multiplier=1,  # one task at a time per worker slot
    result_expires=86400,          # 24h
)

celery_app.conf.beat_schedule = {
    "sync-tiktok-metrics-hourly": {
        "task": "app.workers.tasks.metrics.sync_tiktok_metrics",
        "schedule": 3600.0,  # every hour
    },
}
