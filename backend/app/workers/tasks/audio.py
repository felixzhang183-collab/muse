"""
analyze_song — Celery task
Runs librosa audio analysis on an uploaded song and writes results back to the DB.
"""

import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def _extract_raw_features(y, sr) -> dict:
    """Extract raw librosa features to feed into Claude."""
    import numpy as np
    import librosa

    rms = librosa.feature.rms(y=y)
    rms_db = float(np.mean(librosa.amplitude_to_db(rms)))
    rms_db_range = float(np.max(librosa.amplitude_to_db(rms)) -
                         np.min(librosa.amplitude_to_db(rms + 1e-9)))

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    duration = librosa.get_duration(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    onset_density = round(len(onsets) / max(duration, 1), 2)

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=4)
    mfcc_means = [round(float(np.mean(mfcc[i])), 2) for i in range(4)]

    return {
        "bpm": round(float(tempo), 1),
        "rms_db": round(rms_db, 1),
        "rms_db_range": round(rms_db_range, 1),
        "spectral_centroid_hz": round(centroid, 0),
        "spectral_rolloff_hz": round(rolloff, 0),
        "zero_crossing_rate": round(zcr, 4),
        "onset_density_per_sec": onset_density,
        "duration_sec": round(duration, 1),
        "mfcc_means": mfcc_means,
    }


def _compute_vibe_vector(y, sr) -> dict:
    """
    Use Claude to interpret raw librosa features into a 4-axis vibe vector.
    Falls back to heuristics if the API key is not set.
    """
    import json
    import anthropic
    import numpy as np
    from app.config import settings

    features = _extract_raw_features(y, sr)

    if not settings.anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY not set — using heuristic vibe fallback")
        return _heuristic_vibe(features)

    prompt = f"""You are an expert music analyst. Given these audio features extracted from a song, score it on 4 axes from 0.0 to 1.0.

Audio features:
- BPM: {features['bpm']}
- Loudness (RMS dB): {features['rms_db']} dB
- Dynamic range: {features['rms_db_range']} dB
- Spectral centroid: {features['spectral_centroid_hz']} Hz (brightness — higher = brighter/thinner)
- Spectral rolloff: {features['spectral_rolloff_hz']} Hz
- Zero crossing rate: {features['zero_crossing_rate']} (higher = noisier/more percussive)
- Onset density: {features['onset_density_per_sec']} events/sec (higher = busier/more notes)
- Duration: {features['duration_sec']} sec
- MFCC means (timbre): {features['mfcc_means']}

Score these 4 axes (0.0 = low, 1.0 = high):
- energy: overall intensity, drive, and power
- warmth: tonal richness, bass presence, smoothness (vs bright/harsh)
- chaos: rhythmic/melodic complexity, busyness, unpredictability
- intimacy: closeness, vulnerability, quietness (vs anthemic/stadium)

Respond with ONLY a JSON object, no explanation:
{{"energy": 0.0, "warmth": 0.0, "chaos": 0.0, "intimacy": 0.0}}"""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=64,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    logger.info("Claude vibe response: %r", raw)

    # Extract JSON object even if Claude wraps it in prose
    import re
    match = re.search(r'\{[^{}]+\}', raw)
    if not match:
        logger.warning("Could not parse Claude vibe response, using heuristic fallback")
        return _heuristic_vibe(features)
    vibe = json.loads(match.group())

    return {
        "energy": round(float(np.clip(vibe["energy"], 0, 1)), 3),
        "warmth": round(float(np.clip(vibe["warmth"], 0, 1)), 3),
        "chaos": round(float(np.clip(vibe["chaos"], 0, 1)), 3),
        "intimacy": round(float(np.clip(vibe["intimacy"], 0, 1)), 3),
    }


def _heuristic_vibe(features: dict) -> dict:
    """Simple heuristic fallback when no API key is available."""
    import numpy as np

    energy = float(np.clip((features["rms_db"] + 30) / 30, 0, 1))
    warmth = float(np.clip(1 - (features["spectral_centroid_hz"] / 8000), 0, 1))
    chaos = float(np.clip(features["onset_density_per_sec"] / 15, 0, 1))
    intimacy = float(np.clip(1 - energy, 0, 1))

    return {
        "energy": round(energy, 3),
        "warmth": round(warmth, 3),
        "chaos": round(chaos, 3),
        "intimacy": round(intimacy, 3),
    }


def _detect_key(y, sr) -> str:
    """Return a chord-letter key string like 'C major' or 'A minor'."""
    import numpy as np
    import librosa

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)

    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    # Major profile (Krumhansl-Schmuckler)
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                               2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                               2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    best_score, best_key = -999, "C major"
    for i in range(12):
        rolled_major = np.roll(major_profile, i)
        rolled_minor = np.roll(minor_profile, i)
        score_major = np.corrcoef(chroma_mean, rolled_major)[0, 1]
        score_minor = np.corrcoef(chroma_mean, rolled_minor)[0, 1]
        if score_major > best_score:
            best_score, best_key = score_major, f"{note_names[i]} major"
        if score_minor > best_score:
            best_score, best_key = score_minor, f"{note_names[i]} minor"

    return best_key


def _detect_sections(y, sr, n_sections: int = 6) -> list[dict]:
    """Segment the track into coarse sections using MFCC agglomerative clustering."""
    import numpy as np
    import librosa

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    bounds = librosa.segment.agglomerative(mfcc, k=n_sections)
    bound_times = librosa.frames_to_time(bounds, sr=sr)

    labels = ["intro", "verse", "build", "chorus", "break", "outro"]
    sections = []
    for idx, (start, end) in enumerate(zip(bound_times[:-1], bound_times[1:])):
        sections.append({
            "start": round(float(start), 3),
            "end": round(float(end), 3),
            "label": labels[idx % len(labels)],
        })
    return sections


from app.workers.celery_app import celery_app


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def analyze_song(self, song_id: str) -> dict:
    """
    1. Pull the audio file from R2/MinIO into a temp file
    2. Run librosa analysis (BPM, beats, key, vibe vector, sections)
    3. Write results back to the songs table
    4. Update job status in Redis throughout
    """
    from app.database import SessionLocal
    from app.models.song import Song, SongStatus
    from app.services import storage
    from app.services.redis_client import set_job_status

    task_id = self.request.id
    set_job_status(task_id, "running", progress=0)

    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            set_job_status(task_id, "failed", error="Song record not found")
            return {"error": "Song not found"}

        # ── 1. Download audio to temp file ────────────────────────────
        set_job_status(task_id, "running", progress=10)
        ext = os.path.splitext(song.file_name)[1].lower() or ".mp3"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(storage.download_file(song.file_key))

        # ── 2. Load with librosa ──────────────────────────────────────
        set_job_status(task_id, "running", progress=25)
        import librosa
        import numpy as np

        y, sr = librosa.load(tmp_path, sr=None, mono=True)
        duration_sec = float(librosa.get_duration(y=y, sr=sr))

        # ── 3. BPM + beat timestamps ──────────────────────────────────
        set_job_status(task_id, "running", progress=40)
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(round(float(tempo), 2))
        beat_timestamps = [round(float(t), 4) for t in librosa.frames_to_time(beat_frames, sr=sr)]

        # ── 4. Key detection ──────────────────────────────────────────
        set_job_status(task_id, "running", progress=55)
        key = _detect_key(y, sr)

        # ── 5. Vibe vector ────────────────────────────────────────────
        set_job_status(task_id, "running", progress=70)
        vibe = _compute_vibe_vector(y, sr)

        # ── 6. Section detection ──────────────────────────────────────
        set_job_status(task_id, "running", progress=85)
        n_sections = min(6, max(2, int(duration_sec // 30)))
        sections = _detect_sections(y, sr, n_sections=n_sections)

        # ── 7. Write results to DB ────────────────────────────────────
        song.duration_sec = duration_sec
        song.bpm = bpm
        song.key = key
        song.energy = vibe["energy"]
        song.warmth = vibe["warmth"]
        song.chaos = vibe["chaos"]
        song.intimacy = vibe["intimacy"]
        song.beat_timestamps = beat_timestamps
        song.section_markers = sections
        song.status = SongStatus.analyzed
        db.commit()

        result = {
            "song_id": song_id,
            "duration_sec": duration_sec,
            "bpm": bpm,
            "key": key,
            **vibe,
            "beat_count": len(beat_timestamps),
            "sections": len(sections),
        }
        set_job_status(task_id, "complete", progress=100, result=result)
        logger.info("analyze_song complete: %s — %.1f BPM, key=%s", song_id, bpm, key)
        return result

    except Exception as exc:
        logger.exception("analyze_song failed for %s", song_id)
        try:
            song = db.query(Song).filter(Song.id == song_id).first()
            if song:
                song.status = SongStatus.error
                song.error_message = str(exc)
                db.commit()
        except Exception:
            pass
        set_job_status(task_id, "failed", error=str(exc))
        raise self.retry(exc=exc)

    finally:
        db.close()
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
