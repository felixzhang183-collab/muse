from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.distribution import Distribution
from app.models.render import Render, RenderStatus
from app.models.song import Song
from app.models.user import User
from app.schemas.distribution import DistributionOut
from app.services.redis_client import set_job_status
from app.workers.celery_app import celery_app

router = APIRouter()


@router.post("/renders/{render_id}/distribute", response_model=dict)
def distribute_render(
    render_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    render = db.query(Render).filter(Render.id == render_id).first()
    if not render:
        raise HTTPException(status_code=404, detail="Render not found")

    song = db.query(Song).filter(Song.id == render.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Render not found")

    if render.status != RenderStatus.done:
        raise HTTPException(status_code=400, detail="Render must be complete before distributing")

    if not current_user.tiktok_access_token:
        raise HTTPException(status_code=400, detail="TikTok account not connected")

    distribution = Distribution(
        render_id=render_id,
        song_id=song.id,
        user_id=current_user.id,
        platform="tiktok",
    )
    db.add(distribution)
    db.flush()

    set_job_status(distribution.id, {"status": "pending", "progress": 0, "error": None, "result": None})

    task = celery_app.send_task(
        "app.workers.tasks.distribute.distribute_to_tiktok",
        args=[distribution.id],
    )
    distribution.celery_task_id = task.id
    db.commit()

    return {"data": {"distribution_id": distribution.id, "job_id": distribution.id}}


@router.get("/songs/{song_id}/distributions", response_model=dict)
def list_distributions(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    distributions = (
        db.query(Distribution)
        .filter(Distribution.song_id == song_id)
        .order_by(Distribution.created_at.desc())
        .all()
    )
    return {"data": [DistributionOut.model_validate(d) for d in distributions]}


@router.get("/distributions/{distribution_id}", response_model=dict)
def get_distribution(
    distribution_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dist = (
        db.query(Distribution)
        .filter(Distribution.id == distribution_id, Distribution.user_id == current_user.id)
        .first()
    )
    if not dist:
        raise HTTPException(status_code=404, detail="Distribution not found")
    return {"data": DistributionOut.model_validate(dist)}
