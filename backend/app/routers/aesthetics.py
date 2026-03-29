from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.aesthetic import Aesthetic, AestheticVideo
from app.models.user import User
from app.schemas.aesthetic import AestheticCreate, AestheticOut

router = APIRouter()


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_aesthetic(
    body: AestheticCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aesthetic = Aesthetic(
        user_id=current_user.id,
        name=body.name,
        description=body.description,
    )
    db.add(aesthetic)
    db.commit()
    db.refresh(aesthetic)
    out = AestheticOut.model_validate(aesthetic)
    out.video_count = 0
    return {"data": out}


@router.get("", response_model=dict)
def list_aesthetics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import func

    rows = (
        db.query(Aesthetic)
        .filter(Aesthetic.user_id == current_user.id)
        .order_by(Aesthetic.created_at.desc())
        .all()
    )

    counts = dict(
        db.query(AestheticVideo.aesthetic_id, func.count(AestheticVideo.video_id))
        .filter(AestheticVideo.aesthetic_id.in_([r.id for r in rows]))
        .group_by(AestheticVideo.aesthetic_id)
        .all()
    )

    result = []
    for a in rows:
        out = AestheticOut.model_validate(a)
        out.video_count = counts.get(a.id, 0)
        result.append(out)

    return {"data": result}


@router.get("/{aesthetic_id}", response_model=dict)
def get_aesthetic(
    aesthetic_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.schemas.video import VideoOut

    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Aesthetic not found")

    out = AestheticOut.model_validate(aesthetic)
    out.video_count = len(aesthetic.videos)

    return {
        "data": {
            **out.model_dump(),
            "videos": [VideoOut.model_validate(v) for v in aesthetic.videos],
        }
    }


class _AddVideosBody(BaseModel):
    video_ids: list[str]


@router.post("/{aesthetic_id}/videos", response_model=dict)
def add_videos_to_aesthetic(
    aesthetic_id: str,
    body: _AddVideosBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add one or more library videos to an aesthetic (skips duplicates)."""
    from app.models.video import Video
    from app.services import qdrant as qdrant_svc

    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Aesthetic not found")

    # Only accept videos that exist and belong to this user's library
    videos = db.query(Video).filter(Video.id.in_(body.video_ids)).all()
    if not videos:
        raise HTTPException(status_code=404, detail="No matching videos found")

    # Existing memberships — skip to avoid duplicate PK
    existing = {
        row.video_id
        for row in db.query(AestheticVideo.video_id)
        .filter(
            AestheticVideo.aesthetic_id == aesthetic_id,
            AestheticVideo.video_id.in_([v.id for v in videos]),
        )
        .all()
    }

    added = []
    for video in videos:
        if video.id in existing:
            continue
        db.add(AestheticVideo(aesthetic_id=aesthetic_id, video_id=video.id))
        added.append(video.id)

    db.commit()

    # Sync Qdrant payload for each added video
    for video in videos:
        if video.id not in added:
            continue
        if video.qdrant_id:
            db.refresh(video)  # reload aesthetics relationship
            aesthetic_ids = [av.aesthetic_id for av in
                             db.query(AestheticVideo).filter(AestheticVideo.video_id == video.id).all()]
            try:
                qdrant_svc.update_payload(video.qdrant_id, {"aesthetic_ids": aesthetic_ids})
            except Exception:
                pass

    return {"data": {"added": len(added), "skipped": len(body.video_ids) - len(added)}}


@router.delete("/{aesthetic_id}/videos/{video_id}", response_model=dict)
def remove_video_from_aesthetic(
    aesthetic_id: str,
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a video from an aesthetic without deleting the video itself."""
    from app.models.video import Video
    from app.services import qdrant as qdrant_svc

    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Aesthetic not found")

    entry = (
        db.query(AestheticVideo)
        .filter(
            AestheticVideo.aesthetic_id == aesthetic_id,
            AestheticVideo.video_id == video_id,
        )
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Video not in this aesthetic")

    db.delete(entry)
    db.commit()

    # Sync Qdrant payload
    video = db.query(Video).filter(Video.id == video_id).first()
    if video and video.qdrant_id:
        aesthetic_ids = [av.aesthetic_id for av in
                         db.query(AestheticVideo).filter(AestheticVideo.video_id == video_id).all()]
        try:
            qdrant_svc.update_payload(video.qdrant_id, {"aesthetic_ids": aesthetic_ids})
        except Exception:
            pass

    return {"data": {"video_id": video_id}}


@router.delete("/{aesthetic_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_aesthetic(
    aesthetic_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Aesthetic not found")

    # Junction rows are deleted via CASCADE; actual videos are preserved
    db.delete(aesthetic)
    db.commit()
