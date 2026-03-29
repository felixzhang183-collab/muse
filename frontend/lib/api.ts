const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(_extractApiErrorMessage(errBody, res.statusText));
  }
  return res.json();
}

function _extractApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback || "Request failed";
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => {
        if (!d || typeof d !== "object") return null;
        const msg = (d as { msg?: unknown }).msg;
        const loc = (d as { loc?: unknown }).loc;
        const msgText = typeof msg === "string" ? msg : null;
        const locText = Array.isArray(loc) ? loc.map(String).join(".") : null;
        if (!msgText) return null;
        return locText ? `${locText}: ${msgText}` : msgText;
      })
      .filter((v): v is string => Boolean(v));
    if (msgs.length) return msgs.join("; ");
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback || "Request failed";
    }
  }
  return fallback || "Request failed";
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const data = await apiFetch<{ access_token: string; user: User }>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("token", data.access_token);
  return data;
}

export async function register(body: {
  email: string;
  password: string;
  display_name: string;
  artist_name: string;
}) {
  const data = await apiFetch<{ access_token: string; user: User }>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  localStorage.setItem("token", data.access_token);
  return data;
}

export function logout() {
  localStorage.removeItem("token");
}

export async function getMe(): Promise<User> {
  const res = await apiFetch<{ data?: User } | User>("/auth/me");
  return (res as any).data ?? res;
}

// ─── Songs ────────────────────────────────────────────────────────────────────

export async function uploadSong(file: File, title?: string): Promise<{ song_id: string; job_id: string }> {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  const res = await apiFetch<{ data: { song_id: string; job_id: string } }>("/songs", {
    method: "POST",
    body: form,
  });
  return res.data;
}

export async function getSongs(): Promise<SongListItem[]> {
  const res = await apiFetch<{ data: SongListItem[] }>("/songs");
  return res.data;
}

export async function getSong(id: string): Promise<Song> {
  const res = await apiFetch<{ data: Song }>(`/songs/${id}`);
  return res.data;
}

export async function transcribeSongLyrics(songId: string): Promise<{ song_id: string; job_id: string; lyrics_status: string }> {
  const res = await apiFetch<{ data: { song_id: string; job_id: string; lyrics_status: string } }>(
    `/songs/${songId}/lyrics/transcribe`,
    { method: "POST" }
  );
  return res.data;
}

export async function updateLyricsLines(
  songId: string,
  lyricsLines: LyricLine[]
): Promise<{ ok: boolean; count: number }> {
  const res = await apiFetch<{ data: { ok: boolean; count: number } }>(
    `/songs/${songId}/lyrics-lines`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyrics_lines: lyricsLines }),
    }
  );
  return res.data;
}

export async function updateSectionMarkers(
  songId: string,
  sectionMarkers: Array<{ start: number; end: number; label: string }>
): Promise<void> {
  await apiFetch(`/songs/${songId}/sections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section_markers: sectionMarkers }),
  });
}

export async function getStreamUrl(songId: string): Promise<string> {
  const res = await apiFetch<{ data: { url: string } }>(`/songs/${songId}/stream-url`);
  return res.data.url;
}


// ─── Jobs ─────────────────────────────────────────────────────────────────────

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await apiFetch<JobStatus>(`/jobs/${jobId}`);
  return res;
}

// ─── Videos ───────────────────────────────────────────────────────────────────

export async function scrapeVideos(
  query: string,
  maxResults = 10,
  platform: "youtube" | "tiktok" = "tiktok"
): Promise<Array<{ video_id: string; youtube_id: string; job_id: string }>> {
  const res = await apiFetch<{
    data: Array<{ video_id: string; youtube_id: string; job_id: string }>;
    count: number;
  }>("/videos/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults, platform }),
  });
  return res.data;
}

export async function getVideos(): Promise<Video[]> {
  const res = await apiFetch<{ data: Video[] }>("/videos");
  return res.data;
}

export async function getVideoStreamUrl(videoId: string): Promise<{ url: string; duration: number | null }> {
  return apiFetch<{ url: string; duration: number | null }>(`/videos/${videoId}/stream-url`);
}

export async function cancelVideo(videoId: string): Promise<void> {
  await apiFetch(`/videos/${videoId}/cancel`, { method: "POST" });
}

export async function deleteVideo(videoId: string): Promise<void> {
  await apiFetch(`/videos/${videoId}`, { method: "DELETE" });
}

export async function retryVideo(videoId: string): Promise<{ video_id: string; job_id: string }> {
  const res = await apiFetch<{ data: { video_id: string; job_id: string } }>(
    `/videos/${videoId}/retry`,
    { method: "POST" }
  );
  return res.data;
}

export async function getVideoMatches(
  songId: string,
  limit = 6
): Promise<VideoMatch[]> {
  const res = await apiFetch<{ data: VideoMatch[] }>(
    `/songs/${songId}/video-matches?limit=${limit}`
  );
  return res.data;
}

// ─── Aesthetics ───────────────────────────────────────────────────────────────

export async function createAesthetic(body: {
  name: string;
  description?: string;
}): Promise<Aesthetic> {
  const res = await apiFetch<{ data: Aesthetic }>("/aesthetics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function getAesthetics(): Promise<Aesthetic[]> {
  const res = await apiFetch<{ data: Aesthetic[] }>("/aesthetics");
  return res.data;
}

export async function getAesthetic(
  id: string
): Promise<Aesthetic & { videos: Video[] }> {
  const res = await apiFetch<{ data: Aesthetic & { videos: Video[] } }>(
    `/aesthetics/${id}`
  );
  return res.data;
}

export async function deleteAesthetic(id: string): Promise<void> {
  await apiFetch(`/aesthetics/${id}`, { method: "DELETE" });
}

export async function addVideosToAesthetic(
  aestheticId: string,
  videoIds: string[]
): Promise<{ added: number; skipped: number }> {
  const res = await apiFetch<{ data: { added: number; skipped: number } }>(
    `/aesthetics/${aestheticId}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_ids: videoIds }),
    }
  );
  return res.data;
}

export async function removeVideoFromAesthetic(
  aestheticId: string,
  videoId: string
): Promise<void> {
  await apiFetch(`/aesthetics/${aestheticId}/videos/${videoId}`, { method: "DELETE" });
}

export async function scrapeAestheticVideos(
  aestheticId: string | null,
  query: string,
  maxResults = 10,
  platform: "youtube" | "tiktok" = "tiktok"
): Promise<{
  count: number;
  skipped: {
    already_indexed: number;
    duplicate_thumbnail: number;
    junk_title: number;
    wrong_duration: number;
    ai_rejected: number;
  };
}> {
  const body: Record<string, unknown> = { query, max_results: maxResults, platform };
  if (aestheticId) body.aesthetic_id = aestheticId;
  const res = await apiFetch<{
    count: number;
    skipped: {
      already_indexed: number;
      duplicate_thumbnail: number;
      junk_title: number;
      wrong_duration: number;
      ai_rejected: number;
    };
  }>("/videos/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

// ─── Renders ──────────────────────────────────────────────────────────────────


export async function getRenders(songId: string): Promise<Render[]> {
  const res = await apiFetch<{ data: Render[] }>(`/songs/${songId}/renders`);
  return res.data;
}

export async function getRender(renderId: string): Promise<Render> {
  const res = await apiFetch<{ data: Render }>(`/renders/${renderId}`);
  return res.data;
}

export async function getRenderDownloadUrl(renderId: string): Promise<string> {
  const res = await apiFetch<{ data: { url: string } }>(`/renders/${renderId}/download-url`);
  return res.data.url;
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

export async function getTikTokStatus(): Promise<{ connected: boolean; open_id: string | null; expires_at: string | null }> {
  const res = await apiFetch<{ data: { connected: boolean; open_id: string | null; expires_at: string | null } }>("/tiktok/status");
  return res.data;
}

export async function getTikTokAuthUrl(): Promise<{ url: string; state: string }> {
  const res = await apiFetch<{ data: { url: string; state: string } }>("/tiktok/auth");
  return res.data;
}

export async function disconnectTikTok(): Promise<void> {
  await apiFetch("/tiktok/disconnect", { method: "POST" });
}

// ─── Distributions ────────────────────────────────────────────────────────────

export async function distributeRender(renderId: string): Promise<{ distribution_id: string; job_id: string }> {
  const res = await apiFetch<{ data: { distribution_id: string; job_id: string } }>(
    `/renders/${renderId}/distribute`,
    { method: "POST" }
  );
  return res.data;
}

export async function getDistributions(songId: string): Promise<Distribution[]> {
  const res = await apiFetch<{ data: Distribution[] }>(`/songs/${songId}/distributions`);
  return res.data;
}

export async function getDistribution(distributionId: string): Promise<Distribution> {
  const res = await apiFetch<{ data: Distribution }>(`/distributions/${distributionId}`);
  return res.data;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const res = await apiFetch<{ data: AnalyticsSummary }>("/analytics/summary");
  return res.data;
}

export async function getAllDistributions(): Promise<Distribution[]> {
  const res = await apiFetch<{ data: Distribution[] }>("/analytics/distributions");
  return res.data;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  display_name: string;
  artist_name: string;
}

export interface SongListItem {
  id: string;
  title: string;
  file_name: string;
  status: "uploaded" | "analyzing" | "analyzed" | "error";
  bpm: number | null;
  duration_sec: number | null;
  created_at: string;
}

export interface Song extends SongListItem {
  celery_task_id: string | null;
  error_message: string | null;
  key: string | null;
  energy: number | null;
  warmth: number | null;
  chaos: number | null;
  intimacy: number | null;
  beat_timestamps: number[] | null;
  section_markers: Array<{ start: number; end: number; label: string }> | null;
  lyrics_lines: LyricLine[] | null;
  lyrics_status: "not_started" | "transcribing" | "complete" | "error";
  lyrics_celery_task_id: string | null;
  lyrics_error_message: string | null;
  clip_start: number | null;
  clip_end: number | null;
}

export interface LyricLine {
  start: number;
  end: number;
  text: string;
}

export interface LyricStyle {
  font_size?: number;
  bottom_offset?: number;
  align?: "left" | "center" | "right";
}

export interface JobStatus {
  job_id: string;
  status: "pending" | "running" | "complete" | "failed";
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface Aesthetic {
  id: string;
  name: string;
  description: string | null;
  video_count: number;
  created_at: string;
}

export interface Video {
  id: string;
  platform: string;
  youtube_id: string;
  source_url: string | null;
  title: string;
  channel: string;
  duration_sec: number | null;
  thumbnail_url: string;
  search_query: string;
  status: "pending" | "analyzing" | "analyzed" | "error";
  celery_task_id: string | null;
  error_message: string | null;
  visual_mood: string | null;
  color_palette: string[] | null;
  visual_energy: number | null;
  visual_warmth: number | null;
  visual_chaos: number | null;
  visual_intimacy: number | null;
  aesthetic_ids: string[];
  created_at: string;
}

export interface VideoMatch extends Video {
  match_score: number;
}

export interface Distribution {
  id: string;
  render_id: string;
  song_id: string;
  platform: string;
  status: "pending" | "posting" | "posted" | "error";
  celery_task_id: string | null;
  caption: string | null;
  platform_post_id: string | null;
  error_message: string | null;
  view_count: number | null;
  like_count: number | null;
  share_count: number | null;
  comment_count: number | null;
  metrics_fetched_at: string | null;
  created_at: string;
  updated_at: string;
  song_title?: string; // enriched by analytics endpoint
}

export interface AnalyticsSummary {
  total_posts: number;
  total_views: number;
  total_likes: number;
  total_shares: number;
  total_comments: number;
  best_performing: {
    distribution_id: string;
    song_title: string | null;
    view_count: number | null;
    like_count: number | null;
    share_count: number | null;
  } | null;
}

export interface Render {
  id: string;
  song_id: string;
  status: "pending" | "rendering" | "done" | "error";
  celery_task_id: string | null;
  render_file_key: string | null;
  duration_sec: number | null;
  error_message: string | null;
  created_at: string;
}

// ─── Drafts ───────────────────────────────────────────────────────────────────

export interface DraftAssignment {
  section_index: number;
  section_label: string;
  section_start: number;
  section_end: number;
  video_id: string;
  video_title: string;
  video_thumbnail: string;
  ai_reason: string | null;
}

export interface Draft {
  id: string;
  song_id: string;
  aesthetic_id: string;
  clip_start: number | null;
  clip_end: number | null;
  assignments: DraftAssignment[];
  lyric_style: LyricStyle | null;
  ai_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftTemplate {
  id: string;
  user_id: string;
  aesthetic_id: string;
  name: string;
  base_duration_sec: number;
  assignments: Array<{
    section_index: number;
    section_label: string;
    start_ratio: number;
    end_ratio: number;
    video_id: string;
    video_title: string;
    video_thumbnail: string;
    ai_reason: string | null;
  }>;
  lyric_style: LyricStyle | null;
  ai_notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function createDraft(
  songId: string,
  aestheticId: string,
  clipStart?: number,
  clipEnd?: number,
): Promise<Draft> {
  const res = await apiFetch<{ data: Draft }>(`/songs/${songId}/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aesthetic_id: aestheticId,
      ...(clipStart !== undefined ? { clip_start: clipStart } : {}),
      ...(clipEnd !== undefined ? { clip_end: clipEnd } : {}),
    }),
  });
  return res.data;
}

export async function getDrafts(songId: string): Promise<Draft[]> {
  const res = await apiFetch<{ data: Draft[] }>(`/songs/${songId}/drafts`);
  return res.data;
}

export async function updateDraft(
  draftId: string,
  payload: { assignments?: DraftAssignment[]; lyric_style?: LyricStyle }
): Promise<void> {
  await apiFetch(`/drafts/${draftId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteDraft(draftId: string): Promise<void> {
  await apiFetch(`/drafts/${draftId}`, { method: "DELETE" });
}

export async function renderFromDraft(
  draftId: string,
  options?: { lyric_style?: LyricStyle; lyrics_lines?: LyricLine[] }
): Promise<{ render_id: string; job_id: string }> {
  const res = await apiFetch<{ data: { render_id: string; job_id: string } }>(
    `/drafts/${draftId}/render`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(options?.lyric_style ? { lyric_style: options.lyric_style } : {}),
        ...(options?.lyrics_lines ? { lyrics_lines: options.lyrics_lines } : {}),
      }),
    }
  );
  return res.data;
}

export async function saveDraftAsTemplate(
  draftId: string,
  name: string
): Promise<DraftTemplate> {
  const res = await apiFetch<{ data: DraftTemplate }>(`/drafts/${draftId}/template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.data;
}

export async function getDraftTemplates(): Promise<DraftTemplate[]> {
  const res = await apiFetch<{ data: DraftTemplate[] }>("/draft-templates");
  return res.data;
}

export async function deleteDraftTemplate(templateId: string): Promise<void> {
  await apiFetch(`/draft-templates/${templateId}`, { method: "DELETE" });
}

export async function createDraftFromTemplate(
  songId: string,
  templateId: string,
  clipStart?: number,
  clipEnd?: number
): Promise<Draft> {
  const res = await apiFetch<{ data: Draft }>(`/songs/${songId}/drafts/from-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: templateId,
      ...(clipStart !== undefined ? { clip_start: clipStart } : {}),
      ...(clipEnd !== undefined ? { clip_end: clipEnd } : {}),
    }),
  });
  return res.data;
}

// ─── Section Templates ────────────────────────────────────────────────────────

export interface SectionTemplate {
  id: string;
  name: string;
  cuts_ratio: number[];
  labels: string[];
  created_at: string;
}

export async function getSectionTemplates(): Promise<SectionTemplate[]> {
  const res = await apiFetch<{ data: SectionTemplate[] }>("/section-templates");
  return res.data;
}

export async function createSectionTemplate(body: {
  name: string;
  cuts_ratio: number[];
  labels: string[];
}): Promise<SectionTemplate> {
  const res = await apiFetch<{ data: SectionTemplate }>("/section-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function deleteSectionTemplate(id: string): Promise<void> {
  await apiFetch(`/section-templates/${id}`, { method: "DELETE" });
}
