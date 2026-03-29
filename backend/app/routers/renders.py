from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.render import Render
from app.models.user import User
from app.schemas.render import RenderOut
from app.services import storage

router = APIRouter()


@router.get("/{render_id}", response_model=dict)
def get_render(
    render_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    render = db.query(Render).filter(Render.id == render_id).first()
    if not render:
        raise HTTPException(status_code=404, detail="Render not found")
    # verify ownership through song
    from app.models.song import Song

    song = db.query(Song).filter(Song.id == render.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Render not found")
    return {"data": RenderOut.model_validate(render)}


@router.get("/{render_id}/download-url", response_model=dict)
def get_render_download_url(
    render_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    render = db.query(Render).filter(Render.id == render_id).first()
    if not render:
        raise HTTPException(status_code=404, detail="Render not found")
    from app.models.song import Song

    song = db.query(Song).filter(Song.id == render.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Render not found")
    if render.status != "done" or not render.render_file_key:
        raise HTTPException(status_code=400, detail="Render not ready yet")
    url = storage.get_presigned_url(render.render_file_key, expires_in=3600)
    return {"data": {"url": url}}
