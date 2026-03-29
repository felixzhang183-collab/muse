import json
import logging
import random

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models.aesthetic import Aesthetic, AestheticVideo
from app.models.draft import Draft
from app.models.draft_template import DraftTemplate
from app.models.song import Song, SongStatus
from app.models.user import User
from app.models.video import Video
from app.schemas.draft_template import DraftFromTemplateCreate, DraftTemplateCreate, DraftTemplateOut
from app.schemas.draft import DraftCreate, DraftOut, DraftUpdate

router = APIRouter()
logger = logging.getLogger(__name__)


_DEFAULT_LYRIC_STYLE = {"font_size": 11, "bottom_offset": 48, "align": "center"}


class _RenderFromDraftBody(BaseModel):
    lyric_style: dict | None = None
    lyrics_lines: list[dict] | None = None


def _sections_in_clip(
    song: Song,
    clip_start: float | None = None,
    clip_end: float | None = None,
) -> list[dict]:
    """Return section markers filtered to the clip window, times relative to clip_start."""
    if not song.section_markers:
        return []
    dur = float(song.duration_sec or 0)
    if clip_start is None:
        clip_start = float(song.clip_start or 0.0)
    if clip_end is None:
        clip_end = float(song.clip_end) if song.clip_end is not None else dur
    if clip_end <= clip_start:
        clip_end = dur
    sections = []
    for sec in song.section_markers:
        if sec["end"] <= clip_start or sec["start"] >= clip_end:
            continue
        sections.append({
            "start": round(max(sec["start"], clip_start) - clip_start, 3),
            "end": round(min(sec["end"], clip_end) - clip_start, 3),
            "label": sec["label"],
        })
    return sections


def _normalize_lyric_style(style: dict | None) -> dict:
    src = dict(_DEFAULT_LYRIC_STYLE)
    if style:
        src.update(style)
    align = str(src.get("align", "center")).lower()
    if align not in {"left", "center", "right"}:
        align = "center"
    return {
        "font_size": int(src.get("font_size", 11)),
        "bottom_offset": int(src.get("bottom_offset", 48)),
        "align": align,
    }


def _resolve_clip_window(song: Song, clip_start: float | None, clip_end: float | None) -> tuple[float, float]:
    dur = float(song.duration_sec or 0)
    start = clip_start if clip_start is not None else float(song.clip_start or 0.0)
    end = clip_end if clip_end is not None else (float(song.clip_end) if song.clip_end is not None else dur)
    if end <= start:
        end = dur
    start = max(0.0, min(start, dur))
    end = max(start, min(end, dur))
    return float(start), float(end)


def _ai_assign(sections: list[dict], videos: list[Video], song: Song) -> tuple[list[dict], str]:
    """
    Use Claude to assign a video to each section based on vibe + mood matching.
    Falls back to round-robin if the API call fails.
    Returns (raw_assignments, ai_notes).
    raw_assignments: [{section_index, video_id, ai_reason}]
    """
    try:
        import anthropic

        client = anthropic.Anthropic()

        video_lines = "\n".join(
            f'  id="{v.id}" title="{v.title[:60]}" mood="{v.visual_mood or "?"}"'
            f" energy={round(v.visual_energy or 0, 2)}"
            f" warmth={round(v.visual_warmth or 0, 2)}"
            f" chaos={round(v.visual_chaos or 0, 2)}"
            f" intimacy={round(v.visual_intimacy or 0, 2)}"
            for v in videos
        )
        section_lines = "\n".join(
            f'  index={i} label="{s["label"]}" duration={round(s["end"] - s["start"], 1)}s'
            for i, s in enumerate(sections)
        )

        prompt = (
            "You are a music video editor. Assign each song section to the most visually fitting video clip.\n\n"
            f"Song vibe: energy={round(song.energy or 0, 2)} warmth={round(song.warmth or 0, 2)}"
            f" chaos={round(song.chaos or 0, 2)} intimacy={round(song.intimacy or 0, 2)}\n\n"
            f"Song sections:\n{section_lines}\n\n"
            f"Available video clips:\n{video_lines}\n\n"
            "Rules:\n"
            "- Prefer variety: avoid the same video for adjacent sections\n"
            "- High-energy labels (chorus, drop, build) → high visual_energy clips\n"
            "- Calm labels (intro, verse, outro, bridge, break) → low-energy, warm clips\n"
            "- Return ONLY valid JSON, no markdown fences\n\n"
            'Return: [{"section_index": 0, "video_id": "...", "ai_reason": "one sentence"}, ...]'
        )

        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        text = msg.content[0].text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.splitlines()
            text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[: text.rfind("```")].strip()

        raw = json.loads(text)
        valid_ids = {v.id for v in videos}
        result = []
        for item in raw:
            vid_id = item.get("video_id", "")
            if vid_id not in valid_ids:
                vid_id = videos[0].id
            result.append({
                "section_index": int(item["section_index"]),
                "video_id": vid_id,
                "ai_reason": item.get("ai_reason", ""),
            })

        # Ensure every section index is covered
        covered = {item["section_index"] for item in result}
        for i in range(len(sections)):
            if i not in covered:
                result.append({
                    "section_index": i,
                    "video_id": videos[i % len(videos)].id,
                    "ai_reason": "fallback assignment",
                })

        result.sort(key=lambda x: x["section_index"])
        return result, "Sections assigned by Claude based on energy and mood matching."

    except Exception as exc:
        logger.warning("AI assignment failed (%s) — falling back to round-robin", exc)
        result = [
            {
                "section_index": i,
                "video_id": videos[i % len(videos)].id,
                "ai_reason": "auto-assigned",
            }
            for i in range(len(sections))
        ]
        return result, "Sections auto-assigned (AI unavailable)."


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/songs/{song_id}/drafts", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_draft(
    song_id: str,
    body: DraftCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an AI-assisted draft for a song + aesthetic combination."""
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.status != SongStatus.analyzed:
        raise HTTPException(status_code=400, detail="Song must be fully analyzed")
    if not song.section_markers:
        raise HTTPException(status_code=400, detail="Save sections before creating a draft")

    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == body.aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Aesthetic not found")

    # Fetch analyzed videos belonging to this aesthetic
    video_ids = [
        av.video_id
        for av in db.query(AestheticVideo)
        .filter(AestheticVideo.aesthetic_id == body.aesthetic_id)
        .all()
    ]
    videos = (
        db.query(Video)
        .filter(Video.id.in_(video_ids), Video.status == "analyzed")
        .all()
    )
    if not videos:
        raise HTTPException(
            status_code=400,
            detail="No analyzed videos in this aesthetic — wait for analysis to finish",
        )

    dur = float(song.duration_sec or 0)
    clip_start = body.clip_start if body.clip_start is not None else float(song.clip_start or 0.0)
    clip_end = body.clip_end if body.clip_end is not None else (float(song.clip_end) if song.clip_end is not None else dur)

    sections = _sections_in_clip(song, clip_start, clip_end)
    if not sections:
        raise HTTPException(status_code=400, detail="No sections fall within the selected range")

    # AI assignment
    raw_assignments, ai_notes = _ai_assign(sections, videos, song)

    # Enrich assignments with video metadata
    video_map = {v.id: v for v in videos}
    assignments = []
    for item in raw_assignments:
        idx = item["section_index"]
        if idx >= len(sections):
            continue
        sec = sections[idx]
        vid = video_map.get(item["video_id"])
        if not vid:
            continue
        assignments.append({
            "section_index": idx,
            "section_label": sec["label"],
            "section_start": sec["start"],
            "section_end": sec["end"],
            "video_id": vid.id,
            "video_title": vid.title,
            "video_thumbnail": vid.thumbnail_url,
            "ai_reason": item.get("ai_reason", ""),
        })

    draft = Draft(
        song_id=song_id,
        aesthetic_id=body.aesthetic_id,
        clip_start=clip_start,
        clip_end=clip_end,
        assignments=assignments,
        lyric_style=_DEFAULT_LYRIC_STYLE,
        ai_notes=ai_notes,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    return {"data": DraftOut.model_validate(draft)}


@router.get("/songs/{song_id}/drafts", response_model=dict)
def list_drafts(
    song_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    drafts = (
        db.query(Draft)
        .filter(Draft.song_id == song_id)
        .order_by(Draft.created_at.desc())
        .all()
    )
    return {"data": [DraftOut.model_validate(d) for d in drafts]}


@router.get("/drafts/{draft_id}", response_model=dict)
def get_draft(
    draft_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    song = db.query(Song).filter(Song.id == draft.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"data": DraftOut.model_validate(draft)}


@router.patch("/drafts/{draft_id}", response_model=dict)
def update_draft(
    draft_id: str,
    body: DraftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update draft assignments and/or lyric style."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    song = db.query(Song).filter(Song.id == draft.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Draft not found")
    if body.assignments is not None:
        draft.assignments = body.assignments
    if body.lyric_style is not None:
        draft.lyric_style = _normalize_lyric_style(body.lyric_style)
    db.commit()
    return {"data": {"ok": True}}


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    song = db.query(Song).filter(Song.id == draft.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()


@router.post("/drafts/{draft_id}/render", response_model=dict, status_code=status.HTTP_202_ACCEPTED)
def render_from_draft(
    draft_id: str,
    body: _RenderFromDraftBody | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Kick off a full render using the draft's video assignments."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    song = db.query(Song).filter(Song.id == draft.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.assignments:
        raise HTTPException(status_code=400, detail="Draft has no assignments")

    from app.models.render import Render, RenderStatus
    from app.workers.tasks.render import render_video

    render = Render(
        song_id=song.id,
        aesthetic_id=draft.aesthetic_id,
        status=RenderStatus.pending,
    )
    db.add(render)
    db.commit()
    db.refresh(render)

    task = render_video.delay(
        song.id,
        render.id,
        draft.aesthetic_id,
        draft_id=draft_id,
        lyric_style=(body.lyric_style if body and body.lyric_style is not None else draft.lyric_style),
        lyrics_lines=(body.lyrics_lines if body else None),
    )
    render.celery_task_id = task.id
    render.status = RenderStatus.rendering
    db.commit()

    return {"data": {"render_id": render.id, "job_id": task.id}}


@router.post("/drafts/{draft_id}/template", response_model=dict, status_code=status.HTTP_201_CREATED)
def save_template_from_draft(
    draft_id: str,
    body: DraftTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    song = db.query(Song).filter(Song.id == draft.song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.assignments:
        raise HTTPException(status_code=400, detail="Draft has no assignments")

    clip_start, clip_end = _resolve_clip_window(song, draft.clip_start, draft.clip_end)
    base_duration = max(0.001, clip_end - clip_start)
    assignments: list[dict] = []
    for item in sorted(draft.assignments, key=lambda x: x.get("section_index", 0)):
        try:
            start = float(item["section_start"])
            end = float(item["section_end"])
            if end <= start:
                continue
            start_ratio = max(0.0, min(1.0, start / base_duration))
            end_ratio = max(0.0, min(1.0, end / base_duration))
            if end_ratio <= start_ratio:
                continue
            assignments.append({
                "section_index": int(item.get("section_index", len(assignments))),
                "section_label": str(item.get("section_label", "section")),
                "start_ratio": round(start_ratio, 6),
                "end_ratio": round(end_ratio, 6),
                "video_id": str(item.get("video_id", "")),
                "video_title": str(item.get("video_title", "")),
                "video_thumbnail": str(item.get("video_thumbnail", "")),
                "ai_reason": item.get("ai_reason"),
            })
        except Exception:
            continue

    if not assignments:
        raise HTTPException(status_code=400, detail="Draft assignments are invalid")

    tmpl = DraftTemplate(
        user_id=current_user.id,
        aesthetic_id=draft.aesthetic_id,
        name=body.name.strip(),
        base_duration_sec=round(base_duration, 3),
        assignments=assignments,
        lyric_style=_normalize_lyric_style(draft.lyric_style),
        ai_notes=draft.ai_notes,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return {"data": DraftTemplateOut.model_validate(tmpl)}


@router.get("/draft-templates", response_model=dict)
def list_draft_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    templates = (
        db.query(DraftTemplate)
        .filter(DraftTemplate.user_id == current_user.id)
        .order_by(DraftTemplate.created_at.desc())
        .all()
    )
    return {"data": [DraftTemplateOut.model_validate(t) for t in templates]}


@router.delete("/draft-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tmpl = (
        db.query(DraftTemplate)
        .filter(DraftTemplate.id == template_id, DraftTemplate.user_id == current_user.id)
        .first()
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(tmpl)
    db.commit()


@router.post("/songs/{song_id}/drafts/from-template", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_draft_from_template(
    song_id: str,
    body: DraftFromTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == current_user.id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if song.status != SongStatus.analyzed:
        raise HTTPException(status_code=400, detail="Song must be fully analyzed")

    tmpl = (
        db.query(DraftTemplate)
        .filter(DraftTemplate.id == body.template_id, DraftTemplate.user_id == current_user.id)
        .first()
    )
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if not tmpl.assignments:
        raise HTTPException(status_code=400, detail="Template has no assignments")

    aesthetic = (
        db.query(Aesthetic)
        .filter(Aesthetic.id == tmpl.aesthetic_id, Aesthetic.user_id == current_user.id)
        .first()
    )
    if not aesthetic:
        raise HTTPException(status_code=404, detail="Template aesthetic not found")

    clip_start, clip_end = _resolve_clip_window(song, body.clip_start, body.clip_end)
    clip_duration = max(0.001, clip_end - clip_start)

    # Pull analyzed videos in template aesthetic for fallback replacement.
    video_ids = [
        av.video_id
        for av in db.query(AestheticVideo)
        .filter(AestheticVideo.aesthetic_id == tmpl.aesthetic_id)
        .all()
    ]
    videos = (
        db.query(Video)
        .filter(Video.id.in_(video_ids), Video.status == "analyzed")
        .all()
    )
    if not videos:
        raise HTTPException(status_code=400, detail="Template aesthetic has no analyzed videos")

    assignments: list[dict] = []
    sorted_template = sorted(tmpl.assignments, key=lambda x: x.get("section_index", 0))
    for i, item in enumerate(sorted_template):
        try:
            start_ratio = float(item.get("start_ratio", 0.0))
            end_ratio = float(item.get("end_ratio", 0.0))
            start_ratio = max(0.0, min(1.0, start_ratio))
            end_ratio = max(0.0, min(1.0, end_ratio))
            if end_ratio <= start_ratio:
                continue
            start = round(start_ratio * clip_duration, 3)
            end = round(end_ratio * clip_duration, 3)
            if end <= start:
                continue

            # Always randomize from the full aesthetic pool each time.
            vid = random.choice(videos)

            assignments.append({
                "section_index": i,
                "section_label": str(item.get("section_label", f"section-{i + 1}")),
                "section_start": start,
                "section_end": end,
                "video_id": vid.id,
                "video_title": vid.title,
                "video_thumbnail": vid.thumbnail_url,
                "ai_reason": item.get("ai_reason") or "from template",
            })
        except Exception:
            continue

    if not assignments:
        raise HTTPException(status_code=400, detail="Template assignments are invalid")

    draft = Draft(
        song_id=song.id,
        aesthetic_id=tmpl.aesthetic_id,
        clip_start=clip_start,
        clip_end=clip_end,
        assignments=assignments,
        lyric_style=_normalize_lyric_style(tmpl.lyric_style),
        ai_notes=f'From template "{tmpl.name}"',
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)
    return {"data": DraftOut.model_validate(draft)}
