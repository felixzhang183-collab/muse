"""
render_video — Celery task
Phase 4: Edit Assembly

Pipeline:
1. Load song (sections, beats, audio file, vibe vector) from DB
2. Query Qdrant for top video matches
3. Download matched videos with yt-dlp
4. Extract one subclip per song section using moviepy
5. Concatenate subclips + overlay song audio
6. Upload final mp4 to MinIO/R2
7. Update Render record
"""

import logging
import os
import random
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

# Output resolution
_TARGET_W, _TARGET_H = 1280, 720
_DRAFT_PREVIEW_W = 140
_DRAFT_PREVIEW_H = _DRAFT_PREVIEW_W * (16 / 9)
# yt-dlp format preference: prefer a single merged ≤720p file (works for TikTok),
# fall back to split video+audio for platforms that need it (YouTube, etc.)
_YDL_FORMAT = (
    "best[height<=720][ext=mp4]"
    "/best[height<=720]"
    "/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]"
    "/bestvideo[height<=720]+bestaudio"
    "/best"
)


def _normalize_lyric_style(style: dict | None) -> dict:
    src = style or {}
    align = str(src.get("align", "center")).lower()
    if align not in {"left", "center", "right"}:
        align = "center"
    font_size = int(src.get("font_size", 11) or 11)
    bottom_offset = int(src.get("bottom_offset", 48) or 48)
    return {
        "font_size": max(6, min(240, font_size)),
        "bottom_offset": max(0, min(2000, bottom_offset)),
        "align": align,
    }


def _scale_lyric_style_for_output(style: dict, output_h: int) -> dict:
    """
    Draft lyric controls are authored against the fixed 9:16 preview card in UI.
    Convert those preview-px values into output-px for final render.
    """
    scale = max(0.1, float(output_h) / float(_DRAFT_PREVIEW_H))
    return _normalize_lyric_style(
        {
            "font_size": int(round(float(style["font_size"]) * scale)),
            "bottom_offset": int(round(float(style["bottom_offset"]) * scale)),
            "align": style["align"],
        }
    )


def _normalize_lyrics_lines(lines: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for line in lines or []:
        try:
            start = float(line["start"])
            end = float(line["end"])
            text = str(line.get("text", "")).strip()
            if not text or end <= start:
                continue
            normalized.append({
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
            })
        except Exception:
            continue
    normalized.sort(key=lambda x: x["start"])
    return normalized


def _burn_lyrics_into_video(clip, lyrics_lines_rel: list[dict], lyric_style: dict):
    """
    Draw lyric text directly onto each frame.
    This avoids transparency/compositing edge-cases in some moviepy pipelines.
    """
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    if not lyrics_lines_rel:
        return clip

    font_size = int(lyric_style["font_size"])
    bottom_offset = int(lyric_style["bottom_offset"])
    align = str(lyric_style["align"])

    font = None
    for font_name in ("DejaVuSans.ttf", "Arial.ttf", "Helvetica.ttf"):
        try:
            font = ImageFont.truetype(font_name, size=font_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    width = int(clip.w)
    height = int(clip.h)
    margin_x = 12

    def _active_line(t: float):
        for line in lyrics_lines_rel:
            if line["start"] <= t < line["end"]:
                return line
        return None

    def _annotate(get_frame, t):
        frame = get_frame(t)
        line = _active_line(float(t))
        if not line:
            return frame

        img = Image.fromarray(frame.astype("uint8"))
        draw = ImageDraw.Draw(img)
        text = str(line["text"])
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = max(1, int(bbox[2] - bbox[0]))
        text_h = max(1, int(bbox[3] - bbox[1]))

        if align == "left":
            x = margin_x
        elif align == "right":
            x = width - margin_x - text_w
        else:
            x = (width - text_w) // 2
        y = max(0, min(height - text_h, height - bottom_offset - text_h))

        stroke = max(1, int(round(font_size * 0.12)))
        draw.text(
            (x, y),
            text,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=stroke,
            stroke_fill=(0, 0, 0, 230),
        )
        return np.array(img)

    return clip.fl(_annotate)


def _escape_drawtext_text(text: str) -> str:
    # Escape characters significant to ffmpeg drawtext parser.
    return (
        text.replace("\\", "\\\\")
        .replace(":", r"\:")
        .replace("'", r"\'")
        .replace("%", r"\%")
        .replace("[", r"\[")
        .replace("]", r"\]")
        .replace(",", r"\,")
    )


def _escape_drawtext_path(path: str) -> str:
    return path.replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")


def _find_ffmpeg_fontfile() -> str | None:
    try:
        from pathlib import Path
        import PIL

        candidates = [
            Path(PIL.__file__).resolve().parent / "fonts" / "DejaVuSans.ttf",
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/System/Library/Fonts/Supplemental/Helvetica.ttf"),
            Path("/Library/Fonts/Arial.ttf"),
        ]
        for p in candidates:
            if p.exists():
                return str(p)
    except Exception:
        return None
    return None


def _burn_lyrics_with_ffmpeg(
    input_path: str,
    output_path: str,
    lyrics_lines_rel: list[dict],
    lyric_style: dict,
) -> bool:
    ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
    font_size = int(lyric_style["font_size"])
    bottom_offset = int(lyric_style["bottom_offset"])
    align = str(lyric_style["align"])
    borderw = max(1, int(round(font_size * 0.12)))

    if align == "left":
        x_expr = "24"
    elif align == "right":
        x_expr = "w-tw-24"
    else:
        x_expr = "(w-tw)/2"
    y_expr = f"h-{bottom_offset}-th"

    fontfile = _find_ffmpeg_fontfile()
    filters = []
    textfile_paths: list[str] = []
    work_dir = os.path.dirname(output_path) or "."

    for i, line in enumerate(lyrics_lines_rel):
        s = float(line["start"])
        e = float(line["end"])
        txt = str(line["text"])
        if not txt or e <= s:
            continue
        txt_path = os.path.join(work_dir, f"lyric_{i}.txt")
        with open(txt_path, "w", encoding="utf-8") as fh:
            fh.write(txt)
        textfile_paths.append(txt_path)

        font_part = f"fontfile='{_escape_drawtext_path(fontfile)}':" if fontfile else ""
        filters.append(
            "drawtext="
            f"{font_part}"
            f"textfile='{_escape_drawtext_path(txt_path)}':"
            f"x={x_expr}:y={y_expr}:"
            f"fontsize={font_size}:fontcolor=white:"
            f"borderw={borderw}:bordercolor=black@0.9:"
            f"enable='between(t,{s:.3f},{e:.3f})'"
        )
    if not filters:
        return False

    vf = ",".join(filters)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        input_path,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "copy",
        output_path,
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        logger.info("ffmpeg lyric burn succeeded")
        return True
    except Exception as exc:
        stderr_text = ""
        if hasattr(exc, "stderr") and getattr(exc, "stderr"):
            try:
                stderr_text = exc.stderr.decode("utf-8", errors="ignore")
            except Exception:
                stderr_text = str(exc.stderr)
        logger.warning("ffmpeg lyric burn failed: %s\nffmpeg stderr:\n%s", exc, stderr_text[-4000:])
        return False


def _burn_lyrics_with_moviepy(
    input_path: str,
    output_path: str,
    lyrics_lines_rel: list[dict],
    lyric_style: dict,
) -> bool:
    """
    Fallback lyric burn path when ffmpeg drawtext is unavailable or fails parsing.
    """
    clip = None
    burned = None
    try:
        from moviepy.editor import VideoFileClip

        clip = VideoFileClip(input_path)
        burned = _burn_lyrics_into_video(clip, lyrics_lines_rel, lyric_style)
        burned.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=f"{output_path}.m4a",
            remove_temp=True,
            fps=int(clip.fps or 24),
            preset="ultrafast",
            threads=2,
            logger=None,
        )
        logger.info("moviepy lyric burn fallback succeeded")
        return True
    except Exception as exc:
        logger.warning("moviepy lyric burn fallback failed: %s", exc)
        return False
    finally:
        try:
            if burned is not None:
                burned.close()
        except Exception:
            pass
        try:
            if clip is not None:
                clip.close()
        except Exception:
            pass


def _nearest_time(target: float, candidates: list[float]) -> float:
    if not candidates:
        return target
    return min(candidates, key=lambda c: abs(c - target))


def _normalize_assignments_to_beats(
    assignments: list[tuple[dict, "Video"]],
    beat_timestamps: list[float] | None,
    clip_start: float,
    clip_end: float,
    min_section_sec: float = 0.5,
) -> list[tuple[dict, "Video"]]:
    """
    Snap section boundaries to nearest beat at render-time.
    This guarantees exported cuts stay on-beat even if draft/editor boundaries are unsnapped.
    """
    if not assignments:
        return assignments

    ordered = sorted(assignments, key=lambda pair: float(pair[0]["start"]))
    if len(ordered) == 1:
        sec, vid = ordered[0]
        return [(
            {
                "start": round(max(0.0, float(sec["start"])), 3),
                "end": round(max(0.0, float(sec["end"])), 3),
                "label": sec.get("label", "section"),
            },
            vid,
        )]

    clip_len = max(0.0, float(clip_end) - float(clip_start))
    first_start = max(0.0, float(ordered[0][0]["start"]))
    first_start = min(first_start, clip_len)
    last_end = min(clip_len, float(ordered[-1][0]["end"]))
    last_end = max(last_end, first_start)

    # If the region is too short to enforce min section durations, keep raw timings.
    n_sections = len(ordered)
    min_total = min_section_sec * n_sections
    if (last_end - first_start) < min_total:
        return ordered

    raw_cuts = [float(section["end"]) for section, _ in ordered[:-1]]
    beats_rel = sorted({
        round(float(b) - float(clip_start), 6)
        for b in (beat_timestamps or [])
        if float(clip_start) <= float(b) <= float(clip_end)
    })

    snapped_cuts = [_nearest_time(cut, beats_rel) for cut in raw_cuts]

    # Enforce strict ordering and minimum section duration after snapping.
    adjusted_cuts: list[float] = []
    prev = first_start
    for i, snapped in enumerate(snapped_cuts):
        lower = prev + min_section_sec
        remaining_sections_after = n_sections - (i + 1)
        upper = last_end - (remaining_sections_after * min_section_sec)
        cut = min(max(snapped, lower), upper)
        adjusted_cuts.append(cut)
        prev = cut

    boundaries = [first_start, *adjusted_cuts, last_end]
    normalized: list[tuple[dict, "Video"]] = []
    for i, (section, vid) in enumerate(ordered):
        normalized.append((
            {
                "start": round(boundaries[i], 3),
                "end": round(boundaries[i + 1], 3),
                "label": section.get("label", f"section-{i + 1}"),
            },
            vid,
        ))
    return normalized


def _get_ffmpeg_path() -> str | None:
    """Return the ffmpeg binary bundled with imageio-ffmpeg, or None if unavailable."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _ffmpeg_probe_duration(video_path: str) -> float | None:
    """Get video duration using ffmpeg -i (handles all codecs including H.265/HEVC)."""
    import re
    ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
    try:
        result = subprocess.run(
            [ffmpeg_bin, "-i", video_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        for line in result.stderr.decode("utf-8", errors="ignore").splitlines():
            m = re.search(r"Duration:\s+(\d+):(\d+):([\d.]+)", line)
            if m:
                h, m2, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
                return h * 3600 + m2 * 60 + s
    except Exception:
        pass
    return None


def _ffmpeg_probe_dims(video_path: str) -> tuple[int, int] | None:
    """Get video (width, height) using ffmpeg -i (handles all codecs including H.265/HEVC)."""
    import re
    ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
    try:
        result = subprocess.run(
            [ffmpeg_bin, "-i", video_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        for line in result.stderr.decode("utf-8", errors="ignore").splitlines():
            if "Video:" in line:
                m = re.search(r"(\d{2,5})x(\d{2,5})", line)
                if m:
                    return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return None


def _ffmpeg_cut_clip(input_path: str, start: float, duration: float, output_path: str) -> bool:
    """Extract a clip from input_path using ffmpeg. Handles H.265/HEVC. Returns True on success."""
    ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
    try:
        result = subprocess.run(
            [
                ffmpeg_bin, "-y",
                "-ss", f"{start:.3f}",
                "-i", input_path,
                "-t", f"{duration:.3f}",
                # scale to even dimensions (libx264 requires width/height divisible by 2)
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                "-an",
                output_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        ok = result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
        if not ok:
            err = result.stderr.decode("utf-8", errors="ignore")[-400:] if result.stderr else ""
            logger.warning("ffmpeg_cut_clip failed for %s (rc=%d): %s", input_path, result.returncode, err)
        return ok
    except Exception as e:
        logger.warning("ffmpeg_cut_clip exception for %s: %s", input_path, e)
        return False


def _download_video(source_url: str, work_dir: str) -> str | None:
    """Download a video (YouTube or TikTok) to work_dir. Returns file path or None on failure."""
    import yt_dlp

    ydl_opts = {
        "format": _YDL_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(work_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    ffmpeg_path = _get_ffmpeg_path()
    if ffmpeg_path:
        ydl_opts["ffmpeg_location"] = ffmpeg_path
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=True)
            video_id = info.get("id", "")
            filepath = ydl.prepare_filename(info)
            if not os.path.exists(filepath):
                # yt-dlp may rename after merge — scan work_dir for the id
                for fname in os.listdir(work_dir):
                    if video_id and fname.startswith(video_id):
                        filepath = os.path.join(work_dir, fname)
                        break
                else:
                    for fname in os.listdir(work_dir):
                        if fname.endswith(".mp4"):
                            filepath = os.path.join(work_dir, fname)
                            break
            if os.path.exists(filepath):
                return filepath
    except Exception as e:
        logger.warning("yt-dlp failed for %s: %s", source_url, e)
    return None


def _detect_output_dims(video_path: str) -> tuple[int, int]:
    """Return (width, height) for the output, preserving portrait (9:16) or landscape (16:9)."""
    dims = _ffmpeg_probe_dims(video_path)
    if dims:
        w, h = dims
        return (1080, 1920) if h > w else (_TARGET_W, _TARGET_H)
    try:
        from moviepy.editor import VideoFileClip
        clip = VideoFileClip(video_path, audio=False)
        w, h = clip.size
        clip.close()
        return (1080, 1920) if h > w else (_TARGET_W, _TARGET_H)
    except Exception:
        return _TARGET_W, _TARGET_H


def _get_video_duration(video_path: str) -> float | None:
    dur = _ffmpeg_probe_duration(video_path)
    if dur:
        return dur
    try:
        from moviepy.editor import VideoFileClip
        clip = VideoFileClip(video_path, audio=False)
        dur = float(clip.duration or 0.0)
        clip.close()
        return dur if dur > 0 else None
    except Exception:
        return None


def _resize_cover(clip, target_w: int, target_h: int):
    """Resize+crop like CSS object-cover (used by draft preview cards)."""
    src_w, src_h = clip.size
    if src_w <= 0 or src_h <= 0:
        return clip.resize((target_w, target_h))
    scale = max(target_w / src_w, target_h / src_h)
    resized = clip.resize(scale)
    return resized.crop(
        x_center=resized.w / 2,
        y_center=resized.h / 2,
        width=target_w,
        height=target_h,
    )


def _extract_subclip(
    video_path: str,
    duration: float,
    seed: int,
    target_w: int = _TARGET_W,
    target_h: int = _TARGET_H,
    fixed_start_ratio: float | None = None,
    explicit_start_sec: float | None = None,
    loop_if_needed: bool = False,
    cover_crop: bool = False,
):
    """
    Extract `duration` seconds from video_path, resize to target dimensions.
    Uses ffmpeg subprocess for clip extraction to support all codecs (H.265/HEVC, H.264, etc.).
    Returns a moviepy VideoClip (audio stripped).
    """
    import PIL.Image
    if not hasattr(PIL.Image, "ANTIALIAS"):
        PIL.Image.ANTIALIAS = PIL.Image.LANCZOS

    # Probe duration via ffmpeg (supports H.265/HEVC natively — no re-encoding needed)
    clip_dur = _ffmpeg_probe_duration(video_path) or 0.0
    if clip_dur <= 0:
        raise ValueError(f"Could not determine duration for {video_path}")

    safe_start = clip_dur * 0.20
    safe_end = clip_dur * 0.75
    max_start = safe_end - duration

    if explicit_start_sec is not None and clip_dur > 0:
        start_t = float(explicit_start_sec) % clip_dur if loop_if_needed else max(0.0, min(clip_dur - duration, float(explicit_start_sec)))
    elif fixed_start_ratio is not None:
        start_t = max(0.0, min(clip_dur - duration, clip_dur * fixed_start_ratio))
    elif max_start <= safe_start:
        start_t = safe_start
    else:
        rng = random.Random(seed)
        start_t = rng.uniform(safe_start, max_start)

    from moviepy.editor import VideoFileClip

    if loop_if_needed and clip_dur > 0:
        # For looping (draft preview): pre-encode full video to H.264, then subclip in moviepy
        encoded_path = video_path + ".h264loop.mp4"
        def _encoded_file_ok(path: str) -> bool:
            return (
                os.path.exists(path)
                and os.path.getsize(path) > 1000
                and _ffmpeg_probe_duration(path) is not None
            )
        if not _encoded_file_ok(encoded_path):
            _ffmpeg_cut_clip(video_path, 0, clip_dur, encoded_path)
        if not _encoded_file_ok(encoded_path):
            raise ValueError(f"Cannot re-encode video to H.264 (incompatible codec?): {video_path}")
        clip = VideoFileClip(encoded_path, audio=False)
        from moviepy.editor import concatenate_videoclips
        remaining = float(duration)
        cursor = start_t
        parts = []
        while remaining > 0:
            take = min(remaining, clip_dur - cursor)
            if take <= 0:
                cursor = 0.0
                continue
            parts.append(clip.subclip(cursor, cursor + take))
            remaining -= take
            cursor = 0.0
        sub = parts[0] if len(parts) == 1 else concatenate_videoclips(parts, method="chain")
    else:
        end_t = min(start_t + duration, clip_dur)
        actual_dur = end_t - start_t
        # Cut clip to temp file using ffmpeg — handles H.265/HEVC, outputs H.264
        clip_tmp = f"{video_path}.{int(start_t * 1000)}.clip.mp4"
        if not _ffmpeg_cut_clip(video_path, start_t, actual_dur, clip_tmp):
            raise ValueError(f"ffmpeg failed to extract clip at {start_t:.2f}s from {video_path}")
        clip = VideoFileClip(clip_tmp, audio=False)
        sub = clip

    sub = _resize_cover(sub, target_w, target_h) if cover_crop else sub.resize((target_w, target_h))
    return sub


from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=1, default_retry_delay=60, time_limit=1200)
def render_video(
    self,
    song_id: str,
    render_id: str,
    aesthetic_id: str | None = None,
    draft_id: str | None = None,
    lyric_style: dict | None = None,
    lyrics_lines: list[dict] | None = None,
) -> dict:
    from app.database import SessionLocal
    from app.models.render import Render, RenderStatus
    from app.models.song import Song, SongStatus
    from app.models.video import Video
    from app.services import qdrant as qdrant_svc
    from app.services import storage
    from app.services.redis_client import set_job_status

    task_id = self.request.id
    set_job_status(task_id, "running", progress=0)

    work_dir = tempfile.mkdtemp(prefix="render_")
    db = SessionLocal()

    try:
        render = db.query(Render).filter(Render.id == render_id).first()
        if not render:
            set_job_status(task_id, "failed", error="Render record not found")
            return {"error": "Render not found"}

        song = db.query(Song).filter(Song.id == song_id).first()
        if not song or song.status != SongStatus.analyzed:
            _fail_render(db, render, "Song not analyzed yet")
            set_job_status(task_id, "failed", error="Song not analyzed yet")
            return {"error": "Song not analyzed"}

        song_dur = float(song.duration_sec or 0)
        assignments: list[tuple[dict, Video]] = []

        is_draft_render = bool(draft_id)
        if draft_id:
            # ── Draft path: use pre-assigned video–section pairs ─────────
            from app.models.draft import Draft
            draft = db.query(Draft).filter(Draft.id == draft_id).first()
            if not draft or not draft.assignments:
                raise ValueError("Draft not found or has no assignments")

            set_job_status(task_id, "running", progress=5)
            clip_start = float(draft.clip_start or 0.0)
            clip_end = float(draft.clip_end) if draft.clip_end is not None else song_dur

            for item in sorted(draft.assignments, key=lambda x: x["section_index"]):
                section = {
                    "start": item["section_start"],
                    "end": item["section_end"],
                    "label": item["section_label"],
                }
                vid = db.query(Video).filter(Video.id == item["video_id"]).first()
                if vid and vid.status == "analyzed":
                    assignments.append((section, vid))

            if not assignments:
                raise ValueError("No valid video assignments in draft")

        else:
            # ── Qdrant path: automatic vibe-matched assignment ────────────
            if not song.section_markers or len(song.section_markers) < 1:
                raise ValueError("Song has no section markers — re-analyze first")
            if any(v is None for v in [song.energy, song.warmth, song.chaos, song.intimacy]):
                raise ValueError("Song vibe vector missing — re-analyze first")

            # ── 1. Fetch video matches from Qdrant ────────────────────────
            set_job_status(task_id, "running", progress=5)
            qdrant_svc.init_collection()
            matches = qdrant_svc.search_similar(
                [song.energy, song.warmth, song.chaos, song.intimacy],
                limit=10,
                aesthetic_id=aesthetic_id,
            )
            if not matches:
                raise ValueError(
                    "No video matches found for this aesthetic — scrape some footage first"
                )

            match_videos: list[Video] = []
            for m in matches:
                vid = db.query(Video).filter(Video.id == m["video_id"]).first()
                if vid and vid.status == "analyzed":
                    match_videos.append(vid)

            if not match_videos:
                raise ValueError("No analyzed videos available — wait for video analysis to finish")

            # ── 2. Apply clip region + assign one video per section ───────
            clip_start = float(song.clip_start or 0.0)
            clip_end = float(song.clip_end) if song.clip_end is not None else song_dur
            if clip_end <= clip_start:
                clip_end = song_dur

            raw_sections = song.section_markers
            sections: list[dict] = []
            for sec in raw_sections:
                if sec["end"] <= clip_start or sec["start"] >= clip_end:
                    continue
                sections.append({
                    "start": round(max(sec["start"], clip_start) - clip_start, 3),
                    "end": round(min(sec["end"], clip_end) - clip_start, 3),
                    "label": sec["label"],
                })
            if not sections:
                raise ValueError("No sections fall within the clip region — adjust the clip or re-save sections")

            for i, section in enumerate(sections):
                assignments.append((section, match_videos[i % len(match_videos)]))

        # Keep draft renders exactly as authored in the draft timeline.
        # Only auto-match renders are normalized to beats server-side.
        if not is_draft_render:
            assignments = _normalize_assignments_to_beats(
                assignments=assignments,
                beat_timestamps=song.beat_timestamps,
                clip_start=clip_start,
                clip_end=clip_end,
            )

        # ── 3. Download unique videos ─────────────────────────────────────
        set_job_status(task_id, "running", progress=10)
        unique_vids = {v.id: v for _, v in assignments}
        downloaded: dict[str, str] = {}  # video_id → local file path

        n = len(unique_vids)
        for idx, (vid_id, vid) in enumerate(unique_vids.items()):
            progress = 10 + int(45 * idx / n)
            set_job_status(task_id, "running", progress=progress)
            url = vid.source_url or f"https://www.youtube.com/watch?v={vid.youtube_id}"
            path = _download_video(url, work_dir)
            if path:
                downloaded[vid_id] = path
                logger.info("Downloaded %s → %s", url, path)
            else:
                logger.warning("Skipping video %s (download failed)", url)

        if not downloaded:
            raise ValueError("All video downloads failed — videos may be unavailable")

        # Detect output dimensions from first downloaded video (preserves 9:16 portrait)
        first_path = next(iter(downloaded.values()))
        out_w, out_h = (1080, 1920) if is_draft_render else _detect_output_dims(first_path)
        logger.info("Output dimensions: %dx%d", out_w, out_h)

        # ── 4. Download song audio ────────────────────────────────────────
        set_job_status(task_id, "running", progress=58)
        audio_ext = os.path.splitext(song.file_name)[1].lower() or ".mp3"
        audio_path = os.path.join(work_dir, f"song{audio_ext}")
        with open(audio_path, "wb") as fh:
            fh.write(storage.download_file(song.file_key))

        # ── 5. Build clips with moviepy ───────────────────────────────────
        set_job_status(task_id, "running", progress=62)
        from moviepy.editor import AudioFileClip, concatenate_videoclips

        clips = []
        duration_cache: dict[str, float] = {}
        prev_vid_id: str | None = None
        prev_source_start_sec = 0.0
        prev_section_dur = 0.0
        for section, vid in assignments:
            section_dur = section["end"] - section["start"]
            min_section_dur = 0.05 if is_draft_render else 0.5
            if section_dur < min_section_dur:
                continue

            vid_file = downloaded.get(vid.id)
            if not vid_file:
                # fallback to any available download
                vid_file = next(iter(downloaded.values()), None)
            if not vid_file:
                continue

            try:
                # Use (song_id + section start) as deterministic seed for clip position
                seed = hash(f"{song_id}:{section['start']}")
                if is_draft_render:
                    vid_dur = duration_cache.get(vid_file)
                    if vid_dur is None:
                        vid_dur = _get_video_duration(vid_file) or section_dur
                        duration_cache[vid_file] = vid_dur
                    if prev_vid_id == vid.id:
                        source_start_sec = prev_source_start_sec + prev_section_dur
                    else:
                        source_start_sec = vid_dur * 0.20
                    prev_vid_id = vid.id
                    prev_source_start_sec = source_start_sec
                    prev_section_dur = section_dur
                else:
                    source_start_sec = None

                sub = _extract_subclip(
                    vid_file,
                    section_dur,
                    seed,
                    target_w=out_w,
                    target_h=out_h,
                    explicit_start_sec=source_start_sec,
                    loop_if_needed=is_draft_render,
                    cover_crop=is_draft_render,
                )
                clips.append(sub)
            except Exception as e:
                logger.warning(
                    "Failed to extract clip for section %s (%.1fs): %s",
                    section.get("label", "?"),
                    section_dur,
                    e,
                )

        if not clips:
            raise ValueError("No clips could be extracted from the downloaded videos")

        # ── 6. Concatenate + overlay song audio ───────────────────────────
        set_job_status(task_id, "running", progress=78)
        final_video = concatenate_videoclips(clips, method="compose")

        # Pre-trim audio to [clip_start, safe_end] using ffmpeg → WAV (PCM).
        # WAV/PCM encoding is always available, produces exact durations, and avoids
        # MoviePy buffer overrun from VBR MP3 files whose reported duration > actual data.
        probed_audio_dur = _ffmpeg_probe_duration(audio_path) or 0.0
        audio_actual_end = probed_audio_dur if probed_audio_dur > 0 else clip_end
        safe_clip_end = min(clip_end, audio_actual_end - 0.1)
        trim_audio_path = audio_path + ".trim.wav"
        _audio_ffmpeg_bin = _get_ffmpeg_path() or "ffmpeg"
        _use_trim_audio = False
        try:
            _r = subprocess.run(
                [
                    _audio_ffmpeg_bin, "-y",
                    "-ss", f"{clip_start:.3f}",
                    "-i", audio_path,
                    "-t", f"{max(0.1, safe_clip_end - clip_start):.3f}",
                    "-c:a", "pcm_s16le",
                    trim_audio_path,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=60,
            )
            _use_trim_audio = (
                _r.returncode == 0
                and os.path.exists(trim_audio_path)
                and os.path.getsize(trim_audio_path) > 0
            )
            if not _use_trim_audio:
                _trim_err = _r.stderr.decode("utf-8", errors="ignore")[-300:] if _r.stderr else ""
                logger.warning("Audio pre-trim failed (rc=%d): %s", _r.returncode, _trim_err)
        except Exception as _e:
            logger.warning("Audio pre-trim exception: %s", _e)

        if _use_trim_audio:
            # Trimmed audio already starts at 0 (ffmpeg -ss applied)
            audio = AudioFileClip(trim_audio_path)
            min_dur = min(final_video.duration, audio.duration)
        else:
            # Fallback: MoviePy subclip with large safety margin
            audio = AudioFileClip(audio_path)
            safe_audio_end = max(0.0, audio.duration - 1.5)
            audio = audio.subclip(clip_start, min(clip_end, safe_audio_end))
            min_dur = min(final_video.duration, audio.duration)

        final_video = final_video.subclip(0, min_dur)
        audio = audio.subclip(0, min_dur)
        final_video = final_video.set_audio(audio)

        # ── 6.1 Burn-in lyric overlay for draft renders (match draft preview style) ──
        lyrics_lines_used = 0
        lines_rel_for_burn: list[dict] = []
        style_for_burn: dict | None = None
        if is_draft_render:
            style = _scale_lyric_style_for_output(_normalize_lyric_style(lyric_style), out_h)
            source_lines = _normalize_lyrics_lines(lyrics_lines) if lyrics_lines else _normalize_lyrics_lines(song.lyrics_lines)
            lines_rel: list[dict] = []
            for line in source_lines:
                # song-level lyric timings are absolute; convert to clip-relative.
                rel_start = float(line["start"]) - float(clip_start)
                rel_end = float(line["end"]) - float(clip_start)
                if rel_end <= 0 or rel_start >= min_dur:
                    continue
                rel_start = max(0.0, rel_start)
                rel_end = min(min_dur, rel_end)
                if rel_end <= rel_start:
                    continue
                lines_rel.append({
                    "start": round(rel_start, 3),
                    "end": round(rel_end, 3),
                    "text": line["text"],
                })

            if lines_rel:
                lyrics_lines_used = len(lines_rel)
                lines_rel_for_burn = lines_rel
                style_for_burn = style
                logger.info(
                    "lyrics burn prepared: lines=%s style=%s",
                    lyrics_lines_used,
                    style_for_burn,
                )

        # ── 7. Write output file ──────────────────────────────────────────
        set_job_status(task_id, "running", progress=85)
        output_path = os.path.join(work_dir, "render.mp4")
        final_video.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            temp_audiofile=os.path.join(work_dir, "temp_audio.m4a"),
            remove_temp=True,
            fps=24,
            preset="ultrafast",
            threads=2,
            logger=None,
        )

        if is_draft_render and lines_rel_for_burn and style_for_burn:
            burned_path = os.path.join(work_dir, "render_burned.mp4")
            if _burn_lyrics_with_ffmpeg(output_path, burned_path, lines_rel_for_burn, style_for_burn):
                output_path = burned_path
            else:
                fallback_path = os.path.join(work_dir, "render_burned_fallback.mp4")
                if _burn_lyrics_with_moviepy(output_path, fallback_path, lines_rel_for_burn, style_for_burn):
                    output_path = fallback_path

        render_duration = round(float(final_video.duration), 2)

        # Clean up moviepy objects
        try:
            final_video.close()
            audio.close()
            for c in clips:
                c.close()
        except Exception:
            pass

        # ── 8. Upload to MinIO / R2 ───────────────────────────────────────
        set_job_status(task_id, "running", progress=95)
        with open(output_path, "rb") as fh:
            render_bytes = fh.read()
        render_key = storage.upload_file(render_bytes, "render.mp4", prefix="renders")

        # ── 9. Update render record + log videos used ─────────────────────
        render.status = RenderStatus.done
        render.render_file_key = render_key
        render.duration_sec = render_duration

        from app.models.render_video import RenderVideo

        for vid_id in downloaded:
            rv = RenderVideo(render_id=render_id, video_id=vid_id)
            db.merge(rv)  # merge = insert or ignore if already exists

        db.commit()

        result = {"render_id": render_id, "duration_sec": render_duration, "lyrics_lines_used": lyrics_lines_used}
        set_job_status(task_id, "complete", progress=100, result=result)
        logger.info("render_video complete: %s — %.1fs", render_id, render_duration)
        return result

    except Exception as exc:
        logger.exception("render_video failed for render %s", render_id)
        try:
            r = db.query(Render).filter(Render.id == render_id).first()
            if r:
                _fail_render(db, r, str(exc))
        except Exception:
            pass
        set_job_status(task_id, "failed", error=str(exc))
        raise self.retry(exc=exc)

    finally:
        db.close()
        shutil.rmtree(work_dir, ignore_errors=True)


def _fail_render(db, render, message: str) -> None:
    from app.models.render import RenderStatus

    render.status = RenderStatus.error
    render.error_message = message
    db.commit()
