# Handoff — AI Music Marketing Platform

**Last updated:** 2026-03-29
**Status:** Core product running; major draft/lyrics/template features landed. Next priority is frontend design polish + UX refinement.

---

## Current Focus (2026-03-29)

We are now shifting to **frontend design and UX quality** work.

### Recently completed (just before design pass)
- Draft/render parity fixes so draft cuts and lyric overlay behavior are preserved more reliably in render.
- Lyrics transcription and editing tooling:
  - timeline playback
  - drag handles for lyric group boundaries
  - inline lyric text editing
  - zoom controls
  - lyric style controls (size, Y offset, alignment)
  - explicit Save Draft flow that persists assignments + lyric style
- Scraper UX/backend stability:
  - TikTok is now default scraper platform in frontend + backend defaults
  - better API error messages in UI (no more `[object Object]`)
  - hardened video analysis fallback behavior for GPT empty/refusal responses
  - Qdrant indexing failures no longer hard-fail video analysis
- Draft Templates feature:
  - save any draft as a reusable template
  - list/delete templates
  - create new drafts from template
  - template preserves cut structure + lyric style
  - when creating from template, video assignment is randomized from the aesthetic pool each run

### Immediate frontend-design goals
- Improve visual hierarchy and spacing on the Song detail page (`/songs/[id]`) where Draft, Lyrics, and Render workflows coexist.
- Make Draft card controls feel cleaner and less dense (save/render/template actions).
- Improve timeline readability (contrast, labels, handle affordance, playback state visibility).
- Tighten microcopy and status messaging (success/error/loading) for drafting/template actions.
- Ensure responsive behavior on smaller laptop/mobile widths without horizontal crowding.

### Build/runtime note
- `next build` currently passes after replacing `Set` spread patterns that TypeScript rejected in this project config.
- If dev runtime throws missing chunk/module errors (e.g. `Cannot find module './68.js'`), clear stale artifacts:
  - `rm -rf frontend/.next`
  - restart only one mode (`npm run dev` or `npm run build && npm run start`).

---

## What Was Built

A fully automated music marketing pipeline: upload a song → AI analyzes it → scrape matching YouTube or TikTok footage → assemble a beat-synced edit → post to TikTok with an AI-written caption → metrics flow back and re-rank future matches.

### Phase 1 — Foundation
Full local dev stack, end-to-end:
- **Docker Compose** — Postgres 16, Redis 7, Qdrant, MinIO (local S3)
- **FastAPI** — JWT auth, song upload endpoint, Celery job-status polling
- **Celery worker** — async background task processing
- **Next.js 14 frontend** — upload page, song list, song detail with live progress bar
- **Alembic** — `users` + `songs` tables; migration runner wired into Makefile

### Phase 2 — Audio Analysis
Upload a track → Celery runs librosa → Claude Haiku scores the vibe → results in DB and UI.

1. File validated + uploaded to MinIO (`songs/` prefix)
2. `analyze_song` task: librosa extracts BPM, beat timestamps, musical key (Krumhansl-Schmuckler), section markers (MFCC agglomerative clustering)
3. Raw features sent to Claude Haiku → 4-axis vibe vector: `energy`, `warmth`, `chaos`, `intimacy` (0–1 each)
4. Written to `songs` table, status → `analyzed`
5. Frontend polls every 3s, renders analysis when done

### Phase 3 — Video Scraping + AI Analysis
Search YouTube or TikTok via Apify → GPT-4o Vision scores thumbnails → visual vibe stored in Qdrant → song detail shows best matching videos.

1. `POST /videos/scrape` — Apify actor runs synchronously; `platform` field selects `youtube` (default) or `tiktok`
   - YouTube: `apify/youtube-scraper` actor, `searchKeywords` input, duration filter 4–20 min
   - TikTok: `apify/tiktok-scraper` actor, `searchQueries` input, duration filter 10s–10 min
2. Layered pre-insert filters run synchronously (see Filtering section below)
3. `Video` records created with `platform` + `source_url` columns; `analyze_video` task enqueued per video
4. Task fetches thumbnail images → GPT-4o Vision → visual vibe vector + mood description + color palette
   - YouTube: fetches 4 CDN frames (`hqdefault`, `1.jpg`, `2.jpg`, `3.jpg`)
   - TikTok: fetches the single cover image stored in `thumbnail_url`
5. Vibe upserted into Qdrant as a 4D vector (old point deleted first on retry)
6. `GET /songs/{id}/video-matches` — Qdrant cosine similarity search returns closest visual matches to song's audio vibe

**Scraper hardening (Phase 3.1):**
- API token validated at request time, not silently in Celery
- Duration bounds enforced per platform (YouTube: 4–20 min; TikTok: 10s–10 min)
- Junk-title + junk-channel keyword filters (lyrics, compilations, tutorials, software, academy channels)
- GPT-4o mini thumbnail pre-screen — rejects non-scenic/off-topic videos before any DB record is created; fails open (network error = pass through)
- Thumbnail URL deduplication across batch + existing DB rows
- Retry endpoint, per-card progress bars, skip breakdown in scrape response (`already_indexed`, `duplicate_thumbnail`, `junk_title`, `wrong_duration`, `ai_rejected`)

### Phase 4 — Edit Assembly
Song analyzed + footage scraped → "Render Video" → Celery assembles a beat-synced mp4 → download link in UI.

1. `POST /songs/{id}/renders` — creates `Render` record, enqueues `render_video` task
2. Task queries Qdrant for top 10 video matches against song's audio vibe
3. One video assigned per song section, cycling through top matches
4. Each unique video downloaded with yt-dlp (≤720p, `merge_output_format=mp4`)
5. Subclip extracted per section: `section_duration` seconds from the safe zone (20–75% of source) using a deterministic seed so re-renders are consistent
6. All clips resized to 1280×720, concatenated with moviepy `compose`
7. Song audio overlaid; trimmed to whichever is shorter (song or video)
8. Encoded `libx264/aac`, 24fps, `ultrafast` preset → uploaded to MinIO under `renders/`
9. `render_videos` junction rows written so Phase 6 can trace which videos went into which render
10. Frontend polls `/jobs/{id}`, shows progress bar; "Download MP4" appears on completion

### Phase 5 — Distribution
Completed render → "Post to TikTok" → Claude writes caption → 9:16 crop → TikTok Content Posting API v2 → post live.

1. `POST /renders/{render_id}/distribute` — creates `Distribution` record, enqueues `distribute_to_tiktok` task
2. Task downloads render mp4 from MinIO
3. moviepy letterboxes 16:9 → 9:16 (1080×1920) with black bars top/bottom
4. Claude Sonnet 4.6 writes a caption: punchy hook + 2–3 vibe lines + 6–10 hashtags, using song title/BPM/key/vibe + artist name
5. TikTok Content Posting API v2: init upload → PUT video chunk → returns `publish_id`
6. Polls `/v2/post/publish/status/fetch/` up to 2 minutes to get the real TikTok `video_id` (distinct from `publish_id`); falls back to `publish_id` on timeout
7. Distribution updated: status `posted`, `platform_post_id = video_id`
8. Frontend shows inline distribution status on the render card; polls until `posted`

**TikTok OAuth flow:**
- `GET /tiktok/auth` → returns redirect URL; frontend navigates user to TikTok
- `GET /tiktok/callback?code=…` → exchanges code for tokens, saves on `User` row
- `GET /tiktok/status` → `{ connected, open_id, expires_at }`
- `POST /tiktok/disconnect` → clears tokens
- Scopes: `user.info.basic,video.publish,video.upload,video.list`
- Tokens stored as columns on `users`: `tiktok_open_id`, `tiktok_access_token`, `tiktok_refresh_token`, `tiktok_token_expires_at`

### Phase 6 — Analytics Feedback Loop
TikTok metrics synced back hourly → used to re-score video matches → analytics dashboard.

1. `sync_tiktok_metrics` Celery Beat task runs every hour — calls `/v2/video/query/` per user (up to 20 IDs per request), updates `view_count / like_count / share_count / comment_count / metrics_fetched_at` on each `Distribution`
2. `GET /songs/{id}/video-matches` now blends Qdrant cosine score (70%) with per-video engagement rate (30%) via `render_videos → renders → distributions`. Falls back to pure cosine when no performance data exists yet.
3. Engagement rate formula: `(like_count + share_count × 2) / max(view_count, 1)`, averaged across all distributions where that video was used
4. `GET /analytics/summary` — total posts/views/likes/shares, best-performing post
5. `GET /analytics/distributions` — all distributions enriched with song title + metrics
6. Frontend `/analytics` page: 4-stat summary grid, best-performing highlight, per-post rows with like/share progress bars

---

## All Files

### Backend
| File | Purpose |
|---|---|
| `backend/app/main.py` | FastAPI app — registers all routers |
| `backend/app/config.py` | pydantic-settings; `.env` resolved from project root |
| `backend/app/database.py` | SQLAlchemy engine + `SessionLocal` |
| `backend/app/deps.py` | `get_db`, `get_current_user` FastAPI dependencies |
| `backend/app/models/user.py` | `User` — includes TikTok token columns |
| `backend/app/models/song.py` | `Song` — audio analysis results, vibe vector, beat/section JSON |
| `backend/app/models/video.py` | `Video` — YouTube metadata, visual vibe vector, `qdrant_id` |
| `backend/app/models/render.py` | `Render` — `pending→rendering→done/error`, `render_file_key` |
| `backend/app/models/distribution.py` | `Distribution` — `pending→posting→posted/error`, metrics columns |
| `backend/app/models/render_video.py` | `RenderVideo` — junction: which videos were used in each render |
| `backend/app/schemas/` | Pydantic schemas: `SongOut`, `VideoOut`, `RenderOut`, `DistributionOut` |
| `backend/app/routers/auth.py` | Register / login / me — bcrypt, passlib removed |
| `backend/app/routers/songs.py` | Upload, list, get, delete, stream-url, video-matches (with re-scoring), render trigger/list |
| `backend/app/routers/videos.py` | Scrape (YouTube + TikTok via Apify), retry, list, get — all pre-insert filters + AI screen |
| `backend/app/routers/renders.py` | Get render, get download URL |
| `backend/app/routers/jobs.py` | Polls Redis for Celery task progress |
| `backend/app/routers/tiktok.py` | OAuth: auth URL, callback, status, disconnect |
| `backend/app/routers/distributions.py` | POST distribute, GET by song, GET single |
| `backend/app/routers/analytics.py` | Summary stats, full distribution list with metrics |
| `backend/app/services/storage.py` | MinIO/R2 wrapper: upload, download, presigned URL, delete |
| `backend/app/services/qdrant.py` | Qdrant wrapper: `init_collection`, `upsert_video`, `delete_video`, `search_similar` |
| `backend/app/services/redis_client.py` | `set_job_status` / `get_job_status` helpers |
| `backend/app/workers/celery_app.py` | Celery config + Beat schedule (hourly metrics sync) |
| `backend/app/workers/tasks/audio.py` | `analyze_song` — librosa + Claude Haiku vibe scoring |
| `backend/app/workers/tasks/video.py` | `analyze_video` — GPT-4o Vision thumbnail analysis + Qdrant upsert; branches on `platform` for thumbnail fetching |
| `backend/app/workers/tasks/render.py` | `render_video` — yt-dlp + moviepy edit assembly + render_videos logging; uses `video.source_url` directly |
| `backend/app/workers/tasks/distribute.py` | `distribute_to_tiktok` — 9:16 crop + Claude caption + TikTok upload + publish poll |
| `backend/app/workers/tasks/metrics.py` | `sync_tiktok_metrics` — Celery Beat hourly metrics sync |
| `backend/alembic/versions/0001_initial.py` | `users` + `songs` |
| `backend/alembic/versions/0002_videos.py` | `videos` |
| `backend/alembic/versions/0003_renders.py` | `renders` |
| `backend/alembic/versions/0004_distributions.py` | `distributions` + TikTok token columns on `users` |
| `backend/alembic/versions/0005_analytics.py` | `render_videos` + metrics columns on `distributions` |
| `backend/alembic/versions/0006_video_platform.py` | `platform` + `source_url` columns on `videos`; back-fills YouTube URLs |
| `backend/pyproject.toml` | All deps: librosa, moviepy, yt-dlp, openai, anthropic, qdrant-client, httpx, apify-client |

### Frontend
| File | Purpose |
|---|---|
| `frontend/lib/api.ts` | All API calls + TypeScript types |
| `frontend/lib/store.ts` | Zustand auth store |
| `frontend/app/layout.tsx` | Nav: Songs, Videos, TikTok, Analytics |
| `frontend/app/auth/page.tsx` | Login / register |
| `frontend/app/songs/page.tsx` | Song list |
| `frontend/app/songs/upload/page.tsx` | Upload form |
| `frontend/app/songs/[id]/page.tsx` | Song detail: analysis, vibe bars, sections, video matches, renders, distribute button |
| `frontend/app/videos/page.tsx` | Scrape form, video grid, per-card progress, retry, skip breakdown |
| `frontend/app/tiktok/page.tsx` | TikTok connect/disconnect |
| `frontend/app/analytics/page.tsx` | Analytics dashboard: summary stats, per-post table with metrics |

---

## What's Working

- Register / login / logout
- Upload audio (mp3, wav, aiff, flac, m4a, ogg — up to 200MB)
- Background audio analysis: BPM, key, beat timestamps, section markers
- Claude Haiku audio vibe vector (energy, warmth, chaos, intimacy)
- YouTube scrape via Apify with layered filtering: duration 4–20 min, junk title/channel keywords, GPT-4o mini thumbnail pre-screen, thumbnail dedup
- TikTok scrape via Apify (`apify/tiktok-scraper`) with same filter pipeline; duration bounds 10s–10 min
- GPT-4o Vision visual vibe scoring from thumbnails (no video download; TikTok uses cover image, YouTube uses 4 CDN frames)
- Qdrant cosine similarity: song audio vibe ↔ video visual vibe; blends in engagement history once data exists
- Song detail: top 6 video matches with match % and color palette
- Videos page: per-card progress bars, retry on error, skip breakdown by reason
- Render video: yt-dlp download + moviepy beat-synced assembly + MinIO upload
- Song detail: Render button, progress bar, Download MP4 link
- TikTok OAuth: connect/disconnect, tokens stored per user
- Post to TikTok: 9:16 letterbox, Claude Sonnet caption, TikTok Content Posting API v2
- Song detail: "Post to TikTok" on completed renders (falls back to "Connect TikTok" link)
- Inline distribution status polls until `posted`; shows caption on success
- Analytics page: total posts / views / likes / shares, best-performing post, per-post breakdown
- Celery Beat: hourly metrics sync from TikTok Video Query API

---

## Filtering Pipeline (scraper)

Applied in order before any DB write. Cheapest filters first:

| Step | Method | Catches |
|---|---|---|
| Already indexed | Platform video ID lookup in DB | Re-scraping same video |
| Wrong length | Duration bounds per platform | YouTube: <4 min or >20 min; TikTok: <10s or >10 min |
| Junk title | `_JUNK_TITLE_KEYWORDS` list | Lyrics, compilations, tutorials, software |
| Junk channel | `_JUNK_CHANNEL_KEYWORDS` list | Tutorial/academy channels |
| Duplicate thumbnail | Bulk DB query + within-batch set | Mirror channels, reposts |
| AI thumbnail screen | GPT-4o mini Vision, `detail: low` | Off-topic, talking-head, explicit, software UI |

The AI screen is last (most expensive); it fails open — a network error passes the video through.

---

## Post-Launch Fixes (2026-03-28)

| Bug | Root Cause | Fix |
|---|---|---|
| `QdrantClient has no attribute 'search'` | qdrant-client v1.13 removed `client.search()` | Replaced with `client.query_points(query=…).points` in `qdrant.py` |
| yt-dlp `ffmpeg is not installed` | yt-dlp needs ffmpeg to merge video+audio streams; no system ffmpeg | Pass `imageio_ffmpeg.get_ffmpeg_exe()` as `ffmpeg_location` in yt-dlp opts |
| `PIL.Image has no attribute 'ANTIALIAS'` | Pillow 10 removed `ANTIALIAS` (renamed to `LANCZOS`); moviepy still uses old name | Monkey-patch `PIL.Image.ANTIALIAS = PIL.Image.LANCZOS` before moviepy imports in `render.py` and `distribute.py` |
| `schema "np" does not exist` on DB commit | `final_video.duration` returns `np.float64`; psycopg2 doesn't serialize numpy types | Cast to `float()` before assigning to `render.duration_sec` |

## Open Bugs (2026-03-28)

| Bug | Observed | Suspected Cause | Where to look |
|---|---|---|---|
| Cuts are off-beat in rendered video | Playback of rendered mp4 shows cuts landing off the beat | Render worker uses raw section boundary floats from draft assignments without snapping to nearest beat timestamp. SectionEditor snaps in the UI but may not persist snapped values back to the DB before a draft is created. | `backend/app/workers/tasks/render.py` (how cut times are used), `backend/app/routers/drafts.py` `_sections_in_clip()` (times sourced from `Song.section_markers`), SectionEditor save handler in `frontend/app/songs/[id]/page.tsx` (confirm it writes beat-snapped values) |

## Running Locally

```
make up              # start Docker infra (Postgres, Redis, Qdrant, MinIO)
make migrate         # run from project root — always, not from backend/

# Four terminals:
make dev-api         # FastAPI on :8000
make dev-worker      # Celery worker
make dev-beat        # Celery Beat (hourly metrics sync)
make dev-frontend    # Next.js on :3000
```

Stop with Ctrl+C on all four. `redis-cli FLUSHDB` clears stuck tasks.

---

## Known Gotchas

**Poetry not in PATH** — Poetry lives in `~/Library/Python/3.9/bin/`. Add to shell:
```bash
export PATH="$HOME/Library/Python/3.9/bin:$PATH"
```

**`make migrate` must run from project root** — Running from `backend/` breaks `.env` path resolution (`Path(__file__).parent.parent.parent / ".env"` in `config.py`). Don't move `.env`.

**Homebrew not installed** — `brew` was not found. FFmpeg comes from `imageio-ffmpeg` (moviepy dependency) and is used automatically. No system ffmpeg needed.

**librosa / llvmlite pinned** — `llvmlite >=0.43,<0.45` and `numba >=0.60,<0.62`. Newer llvmlite has no pre-built wheel for macOS x86_64. Don't upgrade without checking first.

**Render task is slow** — yt-dlp downloads take 2–5 minutes for a 5-section song with 3 unique videos. Progress bar stalls during downloads; that's expected. `time_limit=1200` (20 min) is the hard ceiling.

**Claude vibe JSON** — Claude Haiku sometimes wraps JSON in prose. A regex extractor handles it; `_heuristic_vibe()` fires if all parsing fails.

**GPT-4o vibe JSON** — `json.loads()` first, then `r"\{[^{}]*\}"` regex fallback. Nested JSON from GPT-4o (rare) breaks the regex; task auto-retries once.

**Qdrant collection** — Auto-created on first video analysis. If you wipe the Qdrant Docker volume, vectors are gone but DB records survive — re-analyze videos to rebuild.

**TikTok `publish_id` vs `video_id`** — After uploading, TikTok returns a temporary `publish_id`. The real public `video_id` (needed for analytics) is returned by polling `/v2/post/publish/status/fetch/`. The distribute task polls up to 2 minutes; if TikTok hasn't processed it yet, `publish_id` is stored as a fallback. The metrics sync will still fail for that row until the real ID is stored — re-running the distribute task would fix it.

**TikTok token expiry** — Access tokens expire in 24 hours; refresh tokens last 1 year. There is no automatic refresh implemented — if a distribute or metrics sync fails with a 401, the user needs to re-authorize on `/tiktok`.

**Re-scoring cold-start** — The blended video-match scoring (70% cosine, 30% engagement) only kicks in once there are posted distributions with metrics synced. Until then it falls back to pure cosine similarity, which is fine.

**YouTube duration bounds** — `_YOUTUBE_MIN_SEC / _YOUTUBE_MAX_SEC` in `videos.py` (currently 240–1200s). Change `_YOUTUBE_MAX_SEC` to `99999` if you want concert footage.

**TikTok duration bounds** — `_TIKTOK_MIN_SEC / _TIKTOK_MAX_SEC` (currently 10s–600s). Most TikTok aesthetic clips are 15–60s which works fine for looping b-roll.

**Apify actor run is synchronous** — `client.actor().call()` blocks until the actor finishes (typically 30–90s for YouTube, 60–120s for TikTok). The scrape HTTP request will hold open that long. This is acceptable for a personal tool; if it becomes a problem, move scraping to a Celery task.

**TikTok `youtube_id` column** — The column is named `youtube_id` for historical reasons but stores the platform-specific video ID for all platforms. `platform` column distinguishes them. Don't rename without a migration.

---

## Key Decisions

| Decision | Rationale |
|---|---|
| 4D vibe vector (energy/warmth/chaos/intimacy) | Simple enough for Qdrant cosine similarity, interpretable enough to write captions from |
| GPT-4o Vision for thumbnails, not frames | No video download needed during scraping; thumbnails are sufficient for vibe matching |
| Apify over YouTube Data API | Apify handles both YouTube and TikTok from one integration; no separate API key per platform |
| `source_url` on `Video` model | Decouples download URL from platform — render task passes it directly to yt-dlp regardless of platform |
| `youtube_id` column kept as platform-specific ID | Avoids a breaking rename migration; `platform` column provides the disambiguation |
| Claude Haiku for audio vibe, Claude Sonnet for captions | Haiku is fast + cheap for structured JSON extraction; Sonnet writes better prose |
| Letterbox (black bars) over crop for TikTok | Preserves all visual content; cropping a 16:9 edit to 9:16 would lose 75% of the frame |
| `render_videos` junction table | Required to trace video → render → distribution performance for re-scoring |
| `publish_id` → poll for real `video_id` | TikTok's video query API requires the public video ID, not the upload's publish ID |
| Beat schedule in `celery_app.py` | Keeps scheduling config co-located with task registration; avoids a separate config file |

---

## What's Next

All 6 phases are complete. Possible future work in priority order:

1. **TikTok token refresh** — implement `/v2/oauth/token/` refresh flow so users don't need to re-authorize daily
2. **Scheduled posting** — add `scheduled_at` to `Distribution` + a Beat task that posts at the right time instead of immediately
3. **Instagram Reels** — same 9:16 pipeline, different OAuth + Graph API; `platform` column on `Distribution` already supports it
4. **Richer analytics** — engagement over time chart, best-performing vibe combos, hashtag performance breakdown
5. **Railway deployment** — env vars for R2, Railway Postgres, Railway Redis; update `CORS` origins and TikTok redirect URI
6. **Async Apify scraping** — move `_apify_search_*` calls into a Celery task so the scrape endpoint returns immediately instead of blocking for 1–2 minutes
