import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.song import Song, SongStatus
from app.models.user import User
from app.schemas.song import SongListItem, SongOut
from app.services import storage

router = APIRouter()

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg"}
MAX_FILE_SIZE_MB = 200


@router.post("", response_model=dict, status_code=status.HTTP_202_ACCEPTED)
async def upload_song(
    file: UploadFile = File(...),
    title: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format. Allowed: {ALLOWED_AUDIO_EXTENSIONS}")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_FILE_SIZE_MB}MB limit")

    # Upload to R2/MinIO
    file_key = storage.upload_file(file_bytes, file.filename, prefix="songs")

    # Derive title from filename if not provided
    song_title = title or os.path.splitext(file.filename or "untitled")[0]

    song = Song(
        user_id=current_user.id,
        title=song_title,
        file_key=file_key,
        file_name=file.filename or "upload",
        status=SongStatus.uploaded,
    )
    db.add(song)
    db.commit()
    db.refresh(song)

    # Enqueue analysis task (import here to avoid circular imports at module load)
    from app.workers.tasks.audio import analyze_song

    task = analyze_song.delay(song.id)
    song.celery_task_id = task.id
    song.status = SongStatus.analyzing
    db.commit()

    return {"data": {"song_id": song.id, "job_id": task.id}}


@router.get("", response_model=dict)
def list_songs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    songs = (
        db.query(Song)
        .filter(Song.user_id == current_user.id)
        .order_by(Song.created_at.desc())
        .all()
    )
    return {"data": [SongListItem.model_validate(s) for s in songs]}


@router.get("/{song_id}", response_model=dict)
def get_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"data": SongOut.model_validate(song)}


@router.get("/{song_id}/stream-url", response_model=dict)
def get_stream_url(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    url = storage.get_presigned_url(song.file_key, expires_in=3600)
    return {"data": {"url": url}}


@router.get("/{song_id}/video-matches", response_model=dict)
def get_video_matches(
    song_id: str,
    limit: int = Query(default=6, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return videos from Qdrant whose visual vibe is closest to this song's audio vibe."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.status != SongStatus.analyzed:
        raise HTTPException(status_code=400, detail="Song not yet analyzed")
    if any(v is None for v in [song.energy, song.warmth, song.chaos, song.intimacy]):
        raise HTTPException(status_code=400, detail="Song vibe vector not available")

    from app.models.video import Video
    from app.schemas.video import VideoOut
    from app.services import qdrant as qdrant_svc

    try:
        qdrant_svc.init_collection()
        matches = qdrant_svc.search_similar(
            [song.energy, song.warmth, song.chaos, song.intimacy],
            limit=limit,
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail="Video matching is temporarily unavailable. Please try again.")

    # Build base results with cosine scores
    raw: list[tuple[Video, float]] = []
    for m in matches:
        vid = db.query(Video).filter(Video.id == m["video_id"]).first()
        if vid:
            raw.append((vid, m["score"]))

    if not raw:
        return {"data": []}

    # Compute per-video engagement rates from historical distributions
    from app.models.distribution import Distribution, DistributionStatus
    from app.models.render_video import RenderVideo

    video_ids = [v.id for v, _ in raw]
    # For each video, find renders it was used in, then distributions with metrics
    perf_scores: dict[str, float] = {}
    for vid_id in video_ids:
        render_ids = [
            rv.render_id
            for rv in db.query(RenderVideo).filter(RenderVideo.video_id == vid_id).all()
        ]
        if not render_ids:
            continue
        dists = (
            db.query(Distribution)
            .filter(
                Distribution.render_id.in_(render_ids),
                Distribution.status == DistributionStatus.posted,
                Distribution.view_count.isnot(None),
                Distribution.view_count > 0,
            )
            .all()
        )
        if not dists:
            continue
        # engagement rate: (likes + shares*2) / views
        rates = [
            ((d.like_count or 0) + (d.share_count or 0) * 2) / max(d.view_count, 1)
            for d in dists
        ]
        perf_scores[vid_id] = sum(rates) / len(rates)

    # Normalize performance scores to 0–1 if any exist
    if perf_scores:
        max_perf = max(perf_scores.values()) or 1.0
        perf_norm = {vid_id: v / max_perf for vid_id, v in perf_scores.items()}
    else:
        perf_norm = {}

    result = []
    for vid, cosine in raw:
        perf = perf_norm.get(vid.id, 0.0)
        blended = round(cosine * 0.7 + perf * 0.3, 3)
        out = VideoOut.model_validate(vid).model_dump()
        out["match_score"] = blended
        result.append(out)

    # Re-sort by blended score descending
    result.sort(key=lambda x: x["match_score"], reverse=True)
    return {"data": result}



@router.get("/{song_id}/renders", response_model=dict)
def list_renders(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    from app.models.render import Render
    from app.schemas.render import RenderOut

    renders = (
        db.query(Render)
        .filter(Render.song_id == song_id)
        .order_by(Render.created_at.desc())
        .all()
    )
    return {"data": [RenderOut.model_validate(r) for r in renders]}


class _SectionsUpdate(BaseModel):
    section_markers: list[dict]


@router.patch("/{song_id}/sections", response_model=dict)
def update_sections(
    song_id: str,
    body: _SectionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Overwrite section_markers for a song (manual edits from the timeline editor)."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    song.section_markers = body.section_markers
    db.commit()
    return {"data": {"ok": True}}


class _ClipUpdate(BaseModel):
    clip_start: float | None
    clip_end: float | None


class _LyricsLine(BaseModel):
    start: float
    end: float
    text: str


class _LyricsLinesUpdate(BaseModel):
    lyrics_lines: list[_LyricsLine]


@router.patch("/{song_id}/clip", response_model=dict)
def update_clip(
    song_id: str,
    body: _ClipUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save the active clip region (in/out points) for a song."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    song.clip_start = body.clip_start
    song.clip_end = body.clip_end
    db.commit()
    return {"data": {"ok": True}}


@router.patch("/{song_id}/lyrics-lines", response_model=dict)
def update_lyrics_lines(
    song_id: str,
    body: _LyricsLinesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Overwrite grouped lyric lines/timings for draft overlay editing."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    normalized = []
    for line in sorted(body.lyrics_lines, key=lambda x: x.start):
        start = float(line.start)
        end = float(line.end)
        text = line.text.strip()
        if not text or end <= start:
            continue
        normalized.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
        })

    song.lyrics_lines = normalized
    if normalized:
        song.lyrics_status = "complete"
        song.lyrics_error_message = None
    db.commit()
    return {"data": {"ok": True, "count": len(normalized)}}


@router.post("/{song_id}/lyrics/transcribe", response_model=dict, status_code=status.HTTP_202_ACCEPTED)
def transcribe_song_lyrics(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Transcribe lyrics with timestamps for draft overlay."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.status != SongStatus.analyzed:
        raise HTTPException(status_code=400, detail="Song must be analyzed before lyric transcription")
    if song.lyrics_status == "transcribing":
        raise HTTPException(status_code=409, detail="Lyric transcription already in progress")

    from app.workers.tasks.lyrics import transcribe_lyrics

    task = transcribe_lyrics.delay(song.id)
    song.lyrics_status = "transcribing"
    song.lyrics_celery_task_id = task.id
    song.lyrics_error_message = None
    db.commit()

    return {"data": {"song_id": song.id, "job_id": task.id, "lyrics_status": song.lyrics_status}}


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    storage.delete_file(song.file_key)
    db.delete(song)
    db.commit()
