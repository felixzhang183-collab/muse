"""
Analytics router — Phase 6: Analytics Feedback Loop

GET /analytics/summary     — aggregate stats across all posted distributions
GET /analytics/distributions — full list of distributions with metrics for the user
"""

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.distribution import Distribution, DistributionStatus
from app.models.render import Render
from app.models.song import Song
from app.models.user import User
from app.schemas.distribution import DistributionOut

router = APIRouter()


@router.get("/analytics/summary", response_model=dict)
def get_analytics_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregate totals across all posted distributions."""
    posted = (
        db.query(Distribution)
        .filter(
            Distribution.user_id == current_user.id,
            Distribution.status == DistributionStatus.posted,
        )
        .all()
    )

    total_posts = len(posted)
    total_views = sum(d.view_count or 0 for d in posted)
    total_likes = sum(d.like_count or 0 for d in posted)
    total_shares = sum(d.share_count or 0 for d in posted)
    total_comments = sum(d.comment_count or 0 for d in posted)

    # Best performing post by views
    best = max(posted, key=lambda d: d.view_count or 0) if posted else None

    best_out = None
    if best:
        song = db.query(Song).filter(Song.id == best.song_id).first()
        best_out = {
            "distribution_id": best.id,
            "song_title": song.title if song else None,
            "view_count": best.view_count,
            "like_count": best.like_count,
            "share_count": best.share_count,
        }

    return {
        "data": {
            "total_posts": total_posts,
            "total_views": total_views,
            "total_likes": total_likes,
            "total_shares": total_shares,
            "total_comments": total_comments,
            "best_performing": best_out,
        }
    }


@router.get("/analytics/distributions", response_model=dict)
def list_all_distributions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All distributions for the current user, enriched with song title."""
    distributions = (
        db.query(Distribution)
        .filter(Distribution.user_id == current_user.id)
        .order_by(Distribution.created_at.desc())
        .all()
    )

    # Batch-load songs for title lookup
    song_ids = {d.song_id for d in distributions}
    songs = {s.id: s for s in db.query(Song).filter(Song.id.in_(song_ids)).all()}

    result = []
    for d in distributions:
        row = DistributionOut.model_validate(d).model_dump()
        row["song_title"] = songs[d.song_id].title if d.song_id in songs else None
        result.append(row)

    return {"data": result}
