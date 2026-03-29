"""
transcribe_lyrics — Celery task

1. Download song audio from storage
2. Transcribe with OpenAI (with timestamps)
3. Group timed words into overlay-friendly lyric lines
4. Save lines to songs.lyrics_lines
"""

import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def _to_dict(obj):
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(obj)


def _normalize_words(payload: dict) -> list[dict]:
    """Return words as [{start, end, text}] with float timestamps."""
    words = payload.get("words") or []
    normalized: list[dict] = []

    for w in words:
        item = _to_dict(w)
        text = (item.get("word") or item.get("text") or "").strip()
        start = item.get("start")
        end = item.get("end")
        if not text or start is None or end is None:
            continue
        normalized.append({
            "start": float(start),
            "end": float(end),
            "text": text,
        })

    if normalized:
        return normalized

    # Fallback: build pseudo-word entries from segments if word-level timestamps
    # are unavailable for a particular model/account setup.
    segments = payload.get("segments") or []
    for s in segments:
        seg = _to_dict(s)
        text = (seg.get("text") or "").strip()
        start = seg.get("start")
        end = seg.get("end")
        if not text or start is None or end is None:
            continue
        normalized.append({
            "start": float(start),
            "end": float(end),
            "text": text,
        })
    return normalized


def _words_to_lyrics_lines(words: list[dict]) -> list[dict]:
    """
    Group timed words into short lyric lines for overlay.
    Keeps lines readable (roughly subtitle-like chunks).
    """
    if not words:
        return []

    lines: list[dict] = []
    chunk: list[dict] = []
    max_chars = 42
    max_duration = 3.2
    gap_split_sec = 0.65

    def flush():
        if not chunk:
            return
        text = " ".join(w["text"] for w in chunk).strip()
        if not text:
            chunk.clear()
            return
        lines.append({
            "start": round(float(chunk[0]["start"]), 3),
            "end": round(float(chunk[-1]["end"]), 3),
            "text": text,
        })
        chunk.clear()

    for w in words:
        if not chunk:
            chunk.append(w)
            continue

        tentative_text = " ".join(x["text"] for x in [*chunk, w])
        duration = float(w["end"]) - float(chunk[0]["start"])
        gap = float(w["start"]) - float(chunk[-1]["end"])
        punctuation_break = chunk[-1]["text"].endswith((".", "!", "?", ",", ";", ":"))

        if (
            len(tentative_text) > max_chars
            or duration > max_duration
            or gap > gap_split_sec
            or punctuation_break
        ):
            flush()
            chunk.append(w)
        else:
            chunk.append(w)

    flush()
    return lines


def _nearest_within(target: float, candidates, max_delta: float) -> float | None:
    if not candidates:
        return None
    best = min(candidates, key=lambda c: abs(c - target))
    if abs(float(best) - target) <= max_delta:
        return float(best)
    return None


def _refine_word_timings_with_audio(words: list[dict], audio_path: str) -> list[dict]:
    """
    Refinement pass (Option 2):
    - Detect audio onsets
    - Snap word starts toward nearby onsets
    - Recompute ends to stay monotonic and avoid overlaps
    """
    if not words:
        return words
    try:
        import librosa

        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))

        onset_frames = librosa.onset.onset_detect(
            y=y,
            sr=sr,
            units="frames",
            backtrack=True,
            pre_max=20,
            post_max=20,
            pre_avg=80,
            post_avg=80,
            delta=0.15,
            wait=20,
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr)
        onset_times = [float(t) for t in onset_times]
        if not onset_times:
            return words

        refined = []
        prev_end = 0.0

        # Pass 1: start-time snapping
        for w in words:
            raw_start = max(0.0, float(w["start"]))
            raw_end = max(raw_start + 0.02, float(w["end"]))
            raw_dur = max(0.04, raw_end - raw_start)

            # Allow stronger snap for short words, looser for longer words
            snap_window = min(0.18, max(0.05, raw_dur * 0.8))
            snapped_start = _nearest_within(raw_start, onset_times, snap_window)
            start = snapped_start if snapped_start is not None else raw_start
            start = max(start, prev_end + 0.005)
            start = min(start, raw_end - 0.02)

            refined.append({
                "start": start,
                "end": raw_end,
                "text": w["text"],
            })
            prev_end = raw_end

        # Pass 2: recompute end-times to avoid overlaps and tiny/negative durations
        for i in range(len(refined)):
            cur = refined[i]
            next_start = refined[i + 1]["start"] if i < len(refined) - 1 else duration
            raw_end = max(float(cur["end"]), cur["start"] + 0.04)
            max_end = max(cur["start"] + 0.04, next_start - 0.005)

            # Optional end snap near onsets
            end_snap_window = min(0.12, max(0.04, (raw_end - cur["start"]) * 0.6))
            snapped_end = _nearest_within(raw_end, onset_times, end_snap_window)
            cand_end = snapped_end if snapped_end is not None else raw_end
            end = min(cand_end, max_end)
            end = max(end, cur["start"] + 0.04)
            cur["end"] = min(end, duration)

        # Round for stable UI edits
        for cur in refined:
            cur["start"] = round(float(cur["start"]), 3)
            cur["end"] = round(float(cur["end"]), 3)
        return refined

    except Exception as exc:
        logger.warning("timing refinement skipped: %s", exc)
        return words


def _transcribe_with_openai(audio_path: str, api_key: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    prompt = (
        "Transcribe only the sung lyrics. Keep slang/ad-libs as heard. "
        "Preserve language as-is."
    )

    # Try a newer model first, then fallback to whisper-1.
    model_attempts = [
        ("gpt-4o-mini-transcribe", True),
        ("whisper-1", True),
        ("whisper-1", False),
    ]
    last_exc: Exception | None = None

    for model, with_granularity in model_attempts:
        try:
            with open(audio_path, "rb") as fh:
                kwargs = {
                    "model": model,
                    "file": fh,
                    "response_format": "verbose_json",
                    "prompt": prompt,
                }
                if with_granularity:
                    kwargs["timestamp_granularities"] = ["word", "segment"]
                resp = client.audio.transcriptions.create(**kwargs)
            return _to_dict(resp)
        except Exception as exc:
            last_exc = exc
            logger.warning("transcription attempt failed (%s, granular=%s): %s", model, with_granularity, exc)
            continue

    raise RuntimeError(f"Transcription failed: {last_exc}")


from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=1, default_retry_delay=30, time_limit=1200)
def transcribe_lyrics(self, song_id: str) -> dict:
    from app.config import settings
    from app.database import SessionLocal
    from app.models.song import Song
    from app.services import storage
    from app.services.redis_client import set_job_status

    task_id = self.request.id
    set_job_status(task_id, "running", progress=0)
    db = SessionLocal()
    tmp_path = ""

    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            set_job_status(task_id, "failed", error="Song record not found")
            return {"error": "Song not found"}

        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set")

        song.lyrics_status = "transcribing"
        song.lyrics_error_message = None
        song.lyrics_celery_task_id = task_id
        db.commit()

        set_job_status(task_id, "running", progress=10)
        ext = os.path.splitext(song.file_name)[1].lower() or ".mp3"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(storage.download_file(song.file_key))

        set_job_status(task_id, "running", progress=35)
        payload = _transcribe_with_openai(tmp_path, settings.openai_api_key)
        words = _normalize_words(payload)
        words = _refine_word_timings_with_audio(words, tmp_path)
        lines = _words_to_lyrics_lines(words)

        if not lines:
            raise RuntimeError("No lyric timestamps returned from transcription")

        set_job_status(task_id, "running", progress=85)
        song.lyrics_lines = lines
        song.lyrics_status = "complete"
        song.lyrics_error_message = None
        db.commit()

        result = {"song_id": song_id, "lines": len(lines)}
        set_job_status(task_id, "complete", progress=100, result=result)
        return result

    except Exception as exc:
        logger.exception("transcribe_lyrics failed for %s", song_id)
        try:
            song = db.query(Song).filter(Song.id == song_id).first()
            if song:
                song.lyrics_status = "error"
                song.lyrics_error_message = str(exc)
                db.commit()
        except Exception:
            pass
        set_job_status(task_id, "failed", error=str(exc))
        raise

    finally:
        db.close()
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
