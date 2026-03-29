import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import get_current_user, get_db
from app.models.user import User
from app.models.video import Video, VideoStatus
from app.schemas.video import ScrapeRequest, VideoOut

router = APIRouter()

# Titles containing these keywords are skipped
_JUNK_TITLE_KEYWORDS = [
    # Compilations / playlists
    "lyric", "lyrics", "compilation", "playlist",
    "1 hour", "2 hour", "3 hour", "hours",
    "top 10", "top 20", "top 50", "top 100",
    "best of", "collection", "karaoke", "mashup",
    # Tutorials / software
    "tutorial", "how to", "howto", "after effects", "aftereffects",
    "premiere pro", "davinci resolve", "resolve", "capcut", "filmora",
    "photoshop", "lightroom", "blender",
    "vfx", "sfx", "plugin", "preset", "lut ", "luts",
    "color grade", "color grading", "color correction",
    "tips", "tricks", "workflow", "walkthrough", "breakdown",
    "learn how", "beginner", "course", "lesson", "masterclass",
    "speed art", "motion graphics", "green screen",
    "reaction", "review", "unboxing", "versus", " vs ",
    # Mix / radio (audio-only streams)
    "mix", "radio", "nonstop", "non-stop",
]

# Channel names containing these are almost certainly tutorial/software channels
_JUNK_CHANNEL_KEYWORDS = [
    "tutorial", "tutorials", "academy", "school", "learn",
    "how to", "education", "training", "course",
    "after effects", "premiere", "davinci", "motion array",
    "videohive", "envato",
]


def _is_junk_video(title: str, channel: str = "") -> bool:
    title_lower = title.lower()
    channel_lower = channel.lower()
    return (
        any(kw in title_lower for kw in _JUNK_TITLE_KEYWORDS)
        or any(kw in channel_lower for kw in _JUNK_CHANNEL_KEYWORDS)
    )


def _thumbnail_passes_ai_screen(thumbnail_url: str, query: str, openai_api_key: str) -> bool:
    """
    Ask GPT-4o mini to judge whether a thumbnail shows scenic/atmospheric footage
    suitable as a music video background. Returns True if it passes, False to reject.
    Fails open (returns True) if the API call errors, so a network blip never kills the whole scrape.
    """
    from openai import OpenAI

    prompt = (
        "You are screening YouTube video thumbnails for use as background footage in a music lyric video.\n\n"
        f'The user searched for: "{query}"\n\n'
        "Does this thumbnail show scenic, atmospheric, or visually interesting footage "
        "(nature, cityscapes, abstract visuals, aesthetic environments, artistic cinematography) "
        "that could work as background visuals for a music video?\n\n"
        "Reject if it shows: a person talking to camera, a software/app interface, a tutorial overlay, "
        "explicit or sexual content, meme/reaction content, or an unrelated product/vlog.\n\n"
        "Reply with exactly one word: YES or NO."
    )

    try:
        client = OpenAI(api_key=openai_api_key)
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=5,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": thumbnail_url, "detail": "low"}},
                    ],
                }
            ],
        )
        answer = resp.choices[0].message.content.strip().upper()
        return answer.startswith("YES")
    except Exception:
        return True  # fail open


# Duration bounds per platform
_YOUTUBE_MIN_SEC = 4 * 60    # 4 min  — mirrors YouTube's videoDuration=medium
_YOUTUBE_MAX_SEC = 20 * 60   # 20 min
_TIKTOK_MIN_SEC  = 5         # 5 s    — allow short loops
_TIKTOK_MAX_SEC  = 10 * 60   # 10 min — TikTok max


def _parse_apify_duration(duration) -> float | None:
    """
    Parse Apify YouTube scraper duration.
    May arrive as an int/float (seconds) or a 'H:MM:SS' / 'MM:SS' string.
    """
    if duration is None:
        return None
    if isinstance(duration, (int, float)):
        return float(duration)
    parts = str(duration).strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
    except (ValueError, IndexError):
        pass
    return None


def _apify_search_tiktok(query: str, max_results: int, api_token: str) -> list[dict]:
    """
    Run the Apify TikTok scraper actor and return normalised items.
    Each item: {youtube_id (TikTok video ID), title, channel, duration_sec, thumbnail_url, source_url}
    """
    from apify_client import ApifyClient

    client = ApifyClient(api_token)
    run = client.actor("clockworks/tiktok-scraper").call(
        run_input={
            "searchQueries": [query],
            "resultsPerPage": max_results,
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
        }
    )
    if run is None:
        raise RuntimeError("Apify TikTok actor run returned no result")

    items = []
    for item in client.dataset(run["defaultDatasetId"]).iterate_items():
        video_id = str(item.get("id", ""))
        if not video_id:
            continue
        source_url = item.get("webVideoUrl", "")
        if not source_url:
            author = item.get("authorMeta", {}).get("name", "")
            source_url = f"https://www.tiktok.com/@{author}/video/{video_id}" if author else ""
        video_meta = item.get("videoMeta", {})
        duration_raw = video_meta.get("duration")
        thumbnail_url = video_meta.get("coverUrl") or video_meta.get("originalCoverUrl") or ""
        items.append({
            "youtube_id": video_id,  # reusing field as platform-specific video ID
            "title": item.get("text", "")[:500],
            "channel": item.get("authorMeta", {}).get("name", ""),
            "duration_sec": float(duration_raw) if duration_raw is not None else None,
            "thumbnail_url": thumbnail_url,
            "source_url": source_url,
        })
    return items


def _apify_search_youtube(query: str, max_results: int, api_token: str) -> list[dict]:
    """
    Run the Apify YouTube scraper actor synchronously and return normalised items.
    Each item: {youtube_id, title, channel, duration_sec, thumbnail_url}
    """
    from apify_client import ApifyClient

    client = ApifyClient(api_token)
    run = client.actor("apify/youtube-scraper").call(
        run_input={
            "searchKeywords": query,
            "maxResultsShown": max_results,
            "type": "SEARCH",
        }
    )
    if run is None:
        raise RuntimeError("Apify actor run returned no result")

    items = []
    for item in client.dataset(run["defaultDatasetId"]).iterate_items():
        yt_id = item.get("id", "")
        if not yt_id:
            continue
        items.append({
            "youtube_id": yt_id,
            "title": item.get("title", ""),
            "channel": item.get("channelName", ""),
            "duration_sec": _parse_apify_duration(item.get("duration")),
            "thumbnail_url": item.get("thumbnailUrl", ""),
        })
    return items


@router.post("/scrape", response_model=dict, status_code=status.HTTP_202_ACCEPTED)
def scrape_videos(
    body: ScrapeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search YouTube or TikTok via Apify for videos matching a query and enqueue visual analysis."""
    from app.models.aesthetic import Aesthetic

    # Validate aesthetic belongs to this user (only if provided)
    aesthetic = None
    if body.aesthetic_id:
        aesthetic = (
            db.query(Aesthetic)
            .filter(Aesthetic.id == body.aesthetic_id, Aesthetic.user_id == current_user.id)
            .first()
        )
        if not aesthetic:
            raise HTTPException(status_code=404, detail="Aesthetic not found")

    if not settings.apify_api_token:
        raise HTTPException(status_code=503, detail="Video scraping is not configured. Please contact support.")
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="Video analysis is not configured. Please contact support.")

    # ── Apify scrape ──────────────────────────────────────────────────
    try:
        if body.platform == "tiktok":
            raw_items = _apify_search_tiktok(body.query, body.max_results, settings.apify_api_token)
        else:
            raw_items = _apify_search_youtube(body.query, body.max_results, settings.apify_api_token)
    except Exception as e:
        raise HTTPException(status_code=502, detail="Video search failed. Please try again.")

    # ── Pre-compute existing thumbnail URLs to dedup ──────────────────
    candidate_thumbnails = {i["thumbnail_url"] for i in raw_items if i["thumbnail_url"]}
    existing_thumbnails: set[str] = set()
    if candidate_thumbnails:
        rows = db.query(Video.thumbnail_url).filter(
            Video.thumbnail_url.in_(candidate_thumbnails)
        ).all()
        existing_thumbnails = {r[0] for r in rows}

    # ── Create Video records ───────────────────────────────────────────
    from app.workers.tasks.video import analyze_video

    skipped = {"already_indexed": 0, "duplicate_thumbnail": 0, "junk_title": 0, "wrong_duration": 0, "ai_rejected": 0}
    seen_thumbnails_this_batch: set[str] = set()
    pending_videos: list[tuple[Video, str]] = []  # (video, yt_id)

    for item in raw_items:
        yt_id = item["youtube_id"]
        title = item["title"]
        channel_name = item["channel"]
        thumbnail_url = item["thumbnail_url"]
        duration_sec = item["duration_sec"]

        # Skip already-indexed YouTube IDs
        if db.query(Video.id).filter(Video.youtube_id == yt_id).first():
            skipped["already_indexed"] += 1
            continue

        # Duration filter — bounds differ per platform
        if duration_sec is not None:
            if body.platform == "tiktok":
                ok = _TIKTOK_MIN_SEC <= duration_sec <= _TIKTOK_MAX_SEC
            else:
                ok = _YOUTUBE_MIN_SEC <= duration_sec <= _YOUTUBE_MAX_SEC
            if not ok:
                skipped["wrong_duration"] += 1
                continue

        # Skip junk titles / channels (tutorials, software, compilations…)
        if _is_junk_video(title, channel_name):
            skipped["junk_title"] += 1
            continue

        # Skip duplicate thumbnails (reposts / mirrors)
        if thumbnail_url and (
            thumbnail_url in existing_thumbnails
            or thumbnail_url in seen_thumbnails_this_batch
        ):
            skipped["duplicate_thumbnail"] += 1
            continue

        # AI thumbnail screen — reject non-scenic / off-topic content
        if thumbnail_url and not _thumbnail_passes_ai_screen(thumbnail_url, body.query, settings.openai_api_key):
            skipped["ai_rejected"] += 1
            continue

        if thumbnail_url:
            seen_thumbnails_this_batch.add(thumbnail_url)

        source_url = item.get("source_url") or (
            f"https://www.youtube.com/watch?v={yt_id}" if body.platform == "youtube" else ""
        )
        video = Video(
            user_id=current_user.id,
            platform=body.platform,
            youtube_id=yt_id,
            source_url=source_url,
            title=title,
            channel=channel_name,
            duration_sec=duration_sec,
            thumbnail_url=thumbnail_url,
            search_query=body.query,
            status=VideoStatus.pending,
        )
        db.add(video)
        db.flush()  # populate video.id
        # Link to aesthetic via junction table (only if one was provided)
        if aesthetic:
            from app.models.aesthetic import AestheticVideo
            db.add(AestheticVideo(aesthetic_id=body.aesthetic_id, video_id=video.id))
        pending_videos.append((video, yt_id))

    # ── Commit all records BEFORE enqueuing tasks to avoid race condition ──
    # (worker must be able to find the video row when the task starts)
    db.commit()

    # ── Enqueue analysis tasks ─────────────────────────────────────────
    created = []
    for video, yt_id in pending_videos:
        task = analyze_video.delay(video.id)
        video.celery_task_id = task.id
        video.status = VideoStatus.analyzing
        created.append({"video_id": video.id, "youtube_id": yt_id, "job_id": task.id})

    db.commit()
    return {"data": created, "count": len(created), "skipped": skipped}


@router.post("/{video_id}/cancel", response_model=dict)
def cancel_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke the Celery analysis task and mark the video as cancelled (error state)."""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.status not in (VideoStatus.analyzing, VideoStatus.pending):
        raise HTTPException(status_code=400, detail="Video is not currently being analyzed")

    if video.celery_task_id:
        from app.workers.celery_app import celery_app
        celery_app.control.revoke(video.celery_task_id, terminate=True)

    video.status = VideoStatus.error
    video.error_message = "Cancelled by user"
    db.commit()

    return {"data": {"video_id": video.id}}


@router.post("/{video_id}/retry", response_model=dict)
def retry_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-enqueue analysis for a failed or errored video."""
    video = _get_user_video(video_id, current_user.id, db)
    if video.status not in (VideoStatus.error, VideoStatus.analyzed):
        raise HTTPException(status_code=400, detail="Video is not in a retryable state")

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="Video analysis is not configured. Please contact support.")

    from app.workers.tasks.video import analyze_video

    video.status = VideoStatus.analyzing
    video.error_message = None
    db.flush()

    task = analyze_video.delay(video.id)
    video.celery_task_id = task.id
    db.commit()

    return {"data": {"video_id": video.id, "job_id": task.id}}


@router.delete("/{video_id}", response_model=dict)
def delete_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a video and revoke any in-progress Celery task."""
    video = _get_user_video(video_id, current_user.id, db)

    if video.celery_task_id and video.status in (VideoStatus.analyzing, VideoStatus.pending):
        from app.workers.celery_app import celery_app
        celery_app.control.revoke(video.celery_task_id, terminate=True)

    db.delete(video)
    db.commit()
    return {"data": {"video_id": video_id}}


@router.get("", response_model=dict)
def list_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.aesthetic import Aesthetic
    from sqlalchemy import or_

    # Include videos owned directly by the user (scraped without an aesthetic)
    # AND videos linked to any of this user's aesthetics (legacy/aesthetic-linked)
    aesthetic_video_ids = (
        db.query(Video.id)
        .join(Video.aesthetics)
        .filter(Aesthetic.user_id == current_user.id)
    )
    videos = (
        db.query(Video)
        .filter(
            or_(
                Video.user_id == current_user.id,
                Video.id.in_(aesthetic_video_ids),
            )
        )
        .order_by(Video.created_at.desc())
        .all()
    )
    return {"data": [VideoOut.model_validate(v) for v in videos]}


def _get_user_video(video_id: str, user_id: str, db: Session) -> Video:
    """Fetch a video that belongs to the current user (direct owner or via aesthetics)."""
    from app.models.aesthetic import Aesthetic
    from sqlalchemy import or_

    aesthetic_video_ids = (
        db.query(Video.id)
        .join(Video.aesthetics)
        .filter(Aesthetic.user_id == user_id)
    )
    video = (
        db.query(Video)
        .filter(
            Video.id == video_id,
            or_(
                Video.user_id == user_id,
                Video.id.in_(aesthetic_video_ids),
            ),
        )
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@router.get("/{video_id}", response_model=dict)
def get_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    video = _get_user_video(video_id, current_user.id, db)
    return {"data": VideoOut.model_validate(video)}


@router.get("/{video_id}/stream-url", response_model=dict)
def get_video_stream_url(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Extract a direct temporary stream URL for a video via yt-dlp (no download)."""
    video = _get_user_video(video_id, current_user.id, db)

    source_url = video.source_url or (
        f"https://www.youtube.com/watch?v={video.youtube_id}" if video.youtube_id else None
    )
    if not source_url:
        raise HTTPException(status_code=404, detail="No source URL for this video")

    try:
        import yt_dlp

        ydl_opts = {
            "format": "best[height<=480][ext=mp4]/best[height<=480]/best",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
        }
        try:
            import imageio_ffmpeg
            ydl_opts["ffmpeg_location"] = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            pass

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(source_url, download=False)
            direct_url = info.get("url")
            if not direct_url:
                formats = [
                    f for f in (info.get("formats") or [])
                    if f.get("url") and f.get("vcodec") not in (None, "none")
                ]
                if formats:
                    direct_url = formats[-1]["url"]
            duration = info.get("duration")

        if not direct_url:
            raise HTTPException(status_code=502, detail="Could not extract stream URL")

        return {"url": direct_url, "duration": duration}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))



def _download_video_to_bytes(source_url: str) -> tuple[bytes, str]:
    """Download the video via yt-dlp to a temp file, return (bytes, extension).

    yt-dlp manages all platform-specific auth/headers itself, so this works
    for TikTok, YouTube, and any other supported platform.
    """
    import os
    import tempfile
    import yt_dlp

    with tempfile.TemporaryDirectory() as tmpdir:
        ydl_opts = {
            "format": "best[height<=480][ext=mp4]/best[height<=480]/best",
            "outtmpl": os.path.join(tmpdir, "video.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
        }
        try:
            import imageio_ffmpeg
            ydl_opts["ffmpeg_location"] = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            pass

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([source_url])

        files = os.listdir(tmpdir)
        if not files:
            raise ValueError("yt-dlp did not produce any output file")

        filepath = os.path.join(tmpdir, files[0])
        ext = os.path.splitext(files[0])[1].lower() or ".mp4"
        with open(filepath, "rb") as f:
            return f.read(), ext


@router.get("/{video_id}/proxy-stream")
async def proxy_video_stream(
    video_id: str,
    token: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Download video via yt-dlp, cache in MinIO, redirect browser to presigned URL.

    On first call: yt-dlp downloads the video (~10-30s), uploads to MinIO, caches key on Video row.
    On subsequent calls: instant redirect to MinIO presigned URL.

    Auth via ?token= query param because <video src> cannot send Authorization headers.
    """
    from app.services import storage

    # Validate JWT from query param
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    video = _get_user_video(video_id, user_id, db)

    # ── Cached: already in MinIO → redirect immediately ──────────────────────
    if video.video_storage_key:
        url = storage.get_presigned_url(video.video_storage_key, expires_in=3600)
        print(f"[proxy] {video_id} → cached, redirecting to MinIO")
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=url, status_code=302)

    # ── Not cached: download via yt-dlp, upload to MinIO ─────────────────────
    source_url = video.source_url or (
        f"https://www.youtube.com/watch?v={video.youtube_id}" if video.youtube_id else None
    )
    if not source_url:
        raise HTTPException(status_code=404, detail="No source URL for this video")

    print(f"[proxy] {video_id} → downloading via yt-dlp from {source_url} ...")
    try:
        import asyncio
        video_bytes, ext = await asyncio.to_thread(_download_video_to_bytes, source_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Download failed: {e}")

    # Upload to MinIO
    key = storage.upload_file(video_bytes, f"video{ext}", prefix="video-previews")
    print(f"[proxy] {video_id} → uploaded {len(video_bytes)//1024}KB to MinIO as {key}")

    # Cache key on the Video row
    video.video_storage_key = key
    db.commit()

    url = storage.get_presigned_url(key, expires_in=3600)
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=url, status_code=302)
