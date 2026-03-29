"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  getAesthetic, getJob, getVideos, retryVideo, cancelVideo, deleteVideo,
  scrapeAestheticVideos, addVideosToAesthetic, removeVideoFromAesthetic,
  type Video,
} from "@/lib/api";

function VibeBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-xs text-paper-2 tracking-wider w-14 shrink-0 uppercase">{label}</span>
      <div className="flex-1 bg-sub h-px relative">
        <div className="absolute left-0 top-0 h-px bg-paper-2 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-data text-xs text-paper-3 w-6 text-right tabular-nums">{pct}</span>
    </div>
  );
}

function ColorSwatch({ colors }: { colors: string[] | null }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div className="flex gap-1 mt-2">
      {colors.map((hex, i) => (
        <div key={i} className="w-3.5 h-3.5" style={{ backgroundColor: hex }} title={hex} />
      ))}
    </div>
  );
}

function AnalyzingProgress({ jobId }: { jobId: string }) {
  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: 3000,
  });
  const pct = job?.progress ?? 0;
  return (
    <div className="mt-2">
      <div className="flex justify-between font-data text-xs text-paper-3 mb-1">
        <span>Analyzing…</span>
        <span>{pct}%</span>
      </div>
      <div className="bg-sub h-px">
        <div className="bg-paper-2 h-px transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function VideoCard({ video, aestheticId }: { video: Video; aestheticId: string }) {
  const queryClient = useQueryClient();
  const mins = video.duration_sec ? Math.floor(video.duration_sec / 60) : null;
  const secs = video.duration_sec ? Math.floor(video.duration_sec % 60) : null;

  const retry = useMutation({
    mutationFn: () => retryVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetic", aestheticId] }),
  });
  const cancel = useMutation({
    mutationFn: () => cancelVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetic", aestheticId] }),
  });
  const remove = useMutation({
    mutationFn: () => removeVideoFromAesthetic(aestheticId, video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetic", aestheticId] }),
  });
  const del = useMutation({
    mutationFn: () => deleteVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetic", aestheticId] }),
  });

  const statusColor =
    video.status === "analyzed"
      ? "text-accent"
      : video.status === "error"
      ? "text-red-400"
      : "text-yellow-600 animate-pulse";

  return (
    <div className="bg-surface border border-sub overflow-hidden">
      <div className="relative aspect-video bg-[#0d0d0d]">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover opacity-90" />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-data text-paper-3 text-xs">
            No thumbnail
          </div>
        )}
        {mins !== null && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white font-data text-xs px-1.5 py-0.5">
            {mins}:{String(secs).padStart(2, "0")}
          </span>
        )}
        {video.platform === "tiktok" && (
          <span className="absolute top-1.5 right-1.5 bg-black/80 font-display text-white text-xs px-1.5 py-0.5 tracking-wider">
            TT
          </span>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-display text-xs font-semibold tracking-wide line-clamp-2 uppercase leading-snug flex-1" title={video.title}>
            {video.title}
          </p>
          <span className={`font-display text-xs tracking-wider uppercase shrink-0 ${statusColor}`}>
            {video.status}
          </span>
        </div>
        <p className="font-data text-xs text-paper-3">{video.channel}</p>

        {(video.status === "analyzing" || video.status === "pending") && video.celery_task_id && (
          <>
            <AnalyzingProgress jobId={video.celery_task_id} />
            <button
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="mt-1.5 font-data text-xs text-paper-3 hover:text-accent transition-colors disabled:opacity-40"
            >
              {cancel.isPending ? "Cancelling…" : "Cancel"}
            </button>
          </>
        )}

        {video.status === "error" && (
          <div className="mt-2">
            {video.error_message && (
              <p className="font-data text-xs text-red-400 line-clamp-2">{video.error_message}</p>
            )}
            <button
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
              className="mt-1.5 font-data text-xs text-paper-2 hover:text-paper underline disabled:opacity-40"
            >
              {retry.isPending ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {video.status === "analyzed" && (
          <>
            {video.visual_mood && (
              <p className="font-data text-xs text-paper-2 mt-2 italic line-clamp-2">{video.visual_mood}</p>
            )}
            <ColorSwatch colors={video.color_palette} />
            <div className="mt-3 flex flex-col gap-2">
              <VibeBar label="Energy" value={video.visual_energy} />
              <VibeBar label="Warmth" value={video.visual_warmth} />
              <VibeBar label="Chaos" value={video.visual_chaos} />
              <VibeBar label="Intimacy" value={video.visual_intimacy} />
            </div>
          </>
        )}

        <div className="mt-3 pt-2 border-t border-sub flex items-center justify-between">
          <a
            href={video.source_url ?? `https://youtube.com/watch?v=${video.youtube_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-data text-xs text-paper-3 hover:text-paper transition-colors"
          >
            {video.platform === "tiktok" ? "TikTok ↗" : "YouTube ↗"}
          </a>
          <div className="flex items-center gap-3">
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="font-data text-xs text-paper-3 hover:text-accent transition-colors disabled:opacity-40"
              title="Remove from this aesthetic"
            >
              {remove.isPending ? "…" : "Remove"}
            </button>
            <button
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="font-data text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
              title="Delete from library"
            >
              {del.isPending ? "…" : "✕"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AestheticDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [platform, setPlatform] = useState<"youtube" | "tiktok">("tiktok");
  const [scrapeResult, setScrapeResult] = useState<{
    count: number;
    skipped: { already_indexed: number; duplicate_thumbnail: number; junk_title: number; wrong_duration: number; ai_rejected: number };
  } | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: aesthetic, isLoading } = useQuery({
    queryKey: ["aesthetic", id],
    queryFn: () => getAesthetic(id),
    refetchInterval: (q) => {
      const videos = q.state.data?.videos ?? [];
      const hasPending = videos.some((v) => v.status === "analyzing" || v.status === "pending");
      return hasPending ? 4000 : false;
    },
  });

  const { data: libraryVideos = [] } = useQuery({
    queryKey: ["videos"],
    queryFn: getVideos,
    enabled: showLibrary,
  });

  const addFromLibrary = useMutation({
    mutationFn: () => addVideosToAesthetic(id, Array.from(selectedIds)),
    onSuccess: () => {
      setSelectedIds(new Set());
      setShowLibrary(false);
      queryClient.invalidateQueries({ queryKey: ["aesthetic", id] });
    },
  });

  const scrape = useMutation({
    mutationFn: () => scrapeAestheticVideos(id, query.trim(), maxResults, platform),
    onSuccess: (res) => {
      setScrapeError(null);
      setScrapeResult({ count: res.count, skipped: res.skipped });
      queryClient.invalidateQueries({ queryKey: ["aesthetic", id] });
    },
    onError: (e: Error) => {
      setScrapeError(e.message);
      setScrapeResult(null);
    },
  });

  const analyzingCount = aesthetic?.videos.filter(
    (v) => v.status === "analyzing" || v.status === "pending"
  ).length ?? 0;

  const totalSkipped = scrapeResult
    ? scrapeResult.skipped.already_indexed +
      scrapeResult.skipped.duplicate_thumbnail +
      scrapeResult.skipped.junk_title +
      (scrapeResult.skipped.wrong_duration ?? 0) +
      (scrapeResult.skipped.ai_rejected ?? 0)
    : 0;

  const selectCls = "bg-surface border border-sub px-3 py-2 font-data text-sm text-paper focus:outline-none focus:border-accent transition-colors";

  if (isLoading) return <p className="font-data text-sm text-paper-3">Loading…</p>;
  if (!aesthetic) return <p className="font-data text-sm text-red-400">Aesthetic not found.</p>;

  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="font-data text-xs text-paper-3 mb-2">
            <a href="/aesthetics" className="hover:text-accent transition-colors">Aesthetics</a>
            <span className="mx-1.5">/</span>
          </p>
          <h1 className="font-display text-5xl font-bold tracking-wider uppercase">{aesthetic.name}</h1>
          <div className="h-[2px] w-8 bg-accent mt-2" />
          {aesthetic.description && (
            <p className="font-data text-sm text-paper-2 mt-3">{aesthetic.description}</p>
          )}
        </div>
        {analyzingCount > 0 && (
          <span className="font-display text-xs text-yellow-600 tracking-[0.15em] uppercase animate-pulse">
            {analyzingCount} analyzing…
          </span>
        )}
      </div>

      {/* Scrape panel */}
      <div className="border border-sub p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper-2">Scrape Footage</h2>
          <div className="flex border border-sub overflow-hidden">
            {(["youtube", "tiktok"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`px-3 py-1.5 font-display text-xs tracking-wider uppercase transition-colors ${
                  platform === p ? "bg-accent text-white" : "text-paper-2 hover:text-paper"
                }`}
              >
                {p === "youtube" ? "YouTube" : "TikTok"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && scrape.mutate()}
            placeholder="e.g. night citylight aesthetic, dark moody cinematic…"
            className="flex-1 min-w-0 bg-surface border border-sub px-4 py-2 font-data text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors"
          />
          <select
            value={maxResults}
            onChange={(e) => setMaxResults(Number(e.target.value))}
            className={selectCls}
          >
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n} results</option>
            ))}
          </select>
          <button
            onClick={() => scrape.mutate()}
            disabled={!query.trim() || scrape.isPending}
            className="bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold px-5 py-2 disabled:opacity-30 hover:bg-accent-dark transition-colors"
          >
            {scrape.isPending ? "Scraping…" : "Scrape"}
          </button>
        </div>

        {scrapeError && <p className="mt-2 font-data text-xs text-accent">{scrapeError}</p>}

        {scrapeResult && (
          <div className="mt-2 font-data text-xs text-paper-2 flex flex-wrap gap-x-4 gap-y-1">
            {scrapeResult.count > 0 ? (
              <span>Queued {scrapeResult.count} video{scrapeResult.count !== 1 ? "s" : ""}</span>
            ) : (
              <span className="text-paper-3">No new videos queued</span>
            )}
            {totalSkipped > 0 && (
              <span className="text-paper-3">
                Skipped {totalSkipped}
                {scrapeResult.skipped.already_indexed > 0 && ` (${scrapeResult.skipped.already_indexed} already indexed`}
                {scrapeResult.skipped.duplicate_thumbnail > 0 && `, ${scrapeResult.skipped.duplicate_thumbnail} duplicate`}
                {scrapeResult.skipped.junk_title > 0 && `, ${scrapeResult.skipped.junk_title} irrelevant`}
                {scrapeResult.skipped.wrong_duration > 0 && `, ${scrapeResult.skipped.wrong_duration} wrong duration`}
                {scrapeResult.skipped.ai_rejected > 0 && `, ${scrapeResult.skipped.ai_rejected} filtered`}
                )
              </span>
            )}
          </div>
        )}
      </div>

      {/* Add from Library */}
      <div className="mb-8">
        <button
          onClick={() => { setShowLibrary((v) => !v); setSelectedIds(new Set()); }}
          className="font-data text-sm text-paper-2 hover:text-paper transition-colors flex items-center gap-1.5"
        >
          <span>{showLibrary ? "▾" : "▸"}</span>
          Add from Library
        </button>

        {showLibrary && (() => {
          const alreadyIn = new Set(aesthetic.videos.map((v) => v.id));
          const available = libraryVideos.filter((v) => !alreadyIn.has(v.id));
          const toggleId = (vid: string) =>
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.has(vid) ? next.delete(vid) : next.add(vid);
              return next;
            });

          return (
            <div className="mt-3 border border-sub p-4">
              {available.length === 0 ? (
                <p className="font-data text-sm text-paper-3">
                  {libraryVideos.length === 0
                    ? "No videos in your library yet."
                    : "All library videos are already in this aesthetic."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-h-[480px] overflow-y-auto pr-1">
                    {available.map((v) => {
                      const selected = selectedIds.has(v.id);
                      return (
                        <button
                          key={v.id}
                          onClick={() => toggleId(v.id)}
                          className={`relative overflow-hidden text-left transition-all ring-2 ${
                            selected ? "ring-accent" : "ring-transparent opacity-60 hover:opacity-100"
                          }`}
                        >
                          <div className="aspect-video bg-[#0d0d0d]">
                            {v.thumbnail_url ? (
                              <img src={v.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-data text-paper-3 text-xs">
                                No thumbnail
                              </div>
                            )}
                            {selected && (
                              <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                                <span className="text-white text-xl">✓</span>
                              </div>
                            )}
                          </div>
                          <p className="font-data text-xs text-paper-2 px-1.5 py-1 line-clamp-1 bg-surface">{v.title}</p>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() => addFromLibrary.mutate()}
                      disabled={selectedIds.size === 0 || addFromLibrary.isPending}
                      className="bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold px-5 py-2 disabled:opacity-30 hover:bg-accent-dark transition-colors"
                    >
                      {addFromLibrary.isPending
                        ? "Adding…"
                        : `Add ${selectedIds.size > 0 ? selectedIds.size : ""} video${selectedIds.size !== 1 ? "s" : ""}`}
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="font-data text-xs text-paper-3 hover:text-paper transition-colors"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* Video grid */}
      {aesthetic.videos.length === 0 ? (
        <p className="font-data text-sm text-paper-3">
          No videos yet. Use the scraper above to find footage for this aesthetic.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {aesthetic.videos.map((v) => (
            <VideoCard key={v.id} video={v} aestheticId={id} />
          ))}
        </div>
      )}
    </div>
  );
}
