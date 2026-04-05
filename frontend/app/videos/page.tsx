"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useInView, type Variants } from "framer-motion";
import {
  getVideos,
  getJob,
  retryVideo,
  cancelVideo,
  deleteVideo,
  getAesthetics,
  scrapeAestheticVideos,
  type Video,
} from "@/lib/api";

// vibe bar that animates its width when it scrolls into view
function VibeBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -20px 0px" });

  return (
    <div ref={ref} className="flex items-center gap-2">
      <span className="font-display text-xs text-paper-2 tracking-wider w-14 shrink-0 uppercase">{label}</span>
      <div className="flex-1 bg-sub h-px relative overflow-hidden">
        <motion.div
          className="absolute left-0 top-0 h-px bg-paper-2"
          initial={{ width: 0 }}
          animate={{ width: inView ? `${pct}%` : 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0, 0, 1], delay: 0.1 }}
        />
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
        <motion.div
          key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: i * 0.04, duration: 0.2 }}
          className="w-3.5 h-3.5"
          style={{ backgroundColor: hex }}
          title={hex}
        />
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
      <div className="bg-sub h-px overflow-hidden">
        <motion.div
          className="bg-paper-2 h-px"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: Math.min(i * 0.04, 0.4), duration: 0.3, ease: [0.25, 0, 0, 1] },
  }),
};

function VideoCard({ video, index }: { video: Video; index: number }) {
  const queryClient = useQueryClient();
  const mins = video.duration_sec ? Math.floor(video.duration_sec / 60) : null;
  const secs = video.duration_sec ? Math.floor(video.duration_sec % 60) : null;
  const [imgLoaded, setImgLoaded] = useState(false);

  const retry = useMutation({
    mutationFn: () => retryVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const cancel = useMutation({
    mutationFn: () => cancelVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const del = useMutation({
    mutationFn: () => deleteVideo(video.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["videos"] }),
  });

  const statusColor =
    video.status === "analyzed"
      ? "text-accent"
      : video.status === "error"
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      layout
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="bg-surface border border-sub overflow-hidden"
    >
      <div className="relative aspect-video bg-[#0d0d0d]">
        {video.thumbnail_url ? (
          <>
            <motion.img
              src={video.thumbnail_url}
              alt={video.title}
              className="w-full h-full object-cover opacity-90"
              initial={{ opacity: 0 }}
              animate={{ opacity: imgLoaded ? 0.9 : 0 }}
              transition={{ duration: 0.4 }}
              onLoad={() => setImgLoaded(true)}
            />
            {!imgLoaded && (
              <div className="absolute inset-0 bg-surface animate-pulse" />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center font-data text-paper-3 text-xs">
            No thumbnail
          </div>
        )}
        {mins !== null && (
          <span className="absolute bottom-1.5 right-1.5 bg-ink/90 text-paper font-data text-xs px-1.5 py-0.5">
            {mins}:{String(secs).padStart(2, "0")}
          </span>
        )}
        {video.platform === "tiktok" && (
          <span className="absolute top-1.5 right-1.5 bg-ink/90 font-display text-paper text-xs px-1.5 py-0.5 tracking-wider">
            TT
          </span>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-display text-xs font-semibold tracking-wide line-clamp-2 uppercase leading-snug flex-1" title={video.title}>
            {video.title}
          </p>
          <motion.span
            className={`font-display text-xs tracking-wider uppercase shrink-0 ${statusColor}`}
            animate={video.status === "analyzing" || video.status === "pending"
              ? { opacity: [1, 0.4, 1] }
              : { opacity: 1 }
            }
            transition={video.status === "analyzing" || video.status === "pending"
              ? { duration: 1.4, repeat: Infinity }
              : {}
            }
          >
            {video.status}
          </motion.span>
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
          <motion.button
            onClick={() => del.mutate()}
            disabled={del.isPending}
            whileTap={{ scale: 0.9 }}
            className="font-data text-xs text-paper-3 hover:text-accent transition-colors disabled:opacity-40"
            title="Delete video"
          >
            {del.isPending ? "…" : "Delete"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

export default function VideosPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [platform, setPlatform] = useState<"youtube" | "tiktok">("tiktok");
  const [aestheticId, setAestheticId] = useState<string | null>(null);
  const [scrapeResult, setScrapeResult] = useState<{
    count: number;
    skipped: { already_indexed: number; duplicate_thumbnail: number; junk_title: number; wrong_duration: number; ai_rejected: number };
  } | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos"],
    queryFn: getVideos,
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      const hasPending = list.some((v) => v.status === "analyzing" || v.status === "pending");
      return hasPending ? 4000 : false;
    },
  });

  const { data: aesthetics = [] } = useQuery({
    queryKey: ["aesthetics"],
    queryFn: getAesthetics,
  });

  const scrape = useMutation({
    mutationFn: () => scrapeAestheticVideos(aestheticId, query.trim(), maxResults, platform),
    onSuccess: (res) => {
      setScrapeError(null);
      setScrapeResult({ count: res.count, skipped: res.skipped });
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
    onError: (e: Error) => {
      setScrapeError(e.message);
      setScrapeResult(null);
    },
  });

  const analyzingCount = videos.filter((v) => v.status === "analyzing" || v.status === "pending").length;

  const totalSkipped = scrapeResult
    ? scrapeResult.skipped.already_indexed +
      scrapeResult.skipped.duplicate_thumbnail +
      scrapeResult.skipped.junk_title +
      (scrapeResult.skipped.wrong_duration ?? 0) +
      (scrapeResult.skipped.ai_rejected ?? 0)
    : 0;

  const selectCls = "bg-surface border border-sub px-3 py-2 font-data text-sm text-paper focus:outline-none focus:border-accent transition-colors";

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-end justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Library</h1>
          <div className="h-[2px] w-8 bg-accent mt-2" />
        </div>
        <AnimatePresence>
          {analyzingCount > 0 && (
            <motion.span
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: [1, 0.4, 1], x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ opacity: { duration: 1.4, repeat: Infinity }, x: { duration: 0.2 } }}
              className="font-display text-xs text-yellow-400 tracking-[0.15em] uppercase"
            >
              {analyzingCount} analyzing…
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {/* scrape panel */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="border border-sub p-5 mb-8"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper-2">Scrape Footage</h2>
          <div className="flex border border-sub overflow-hidden">
            {(["youtube", "tiktok"] as const).map((p) => (
              <motion.button
                key={p}
                onClick={() => setPlatform(p)}
                whileTap={{ scale: 0.97 }}
                className={`px-3 py-1.5 font-display text-xs tracking-wider uppercase transition-colors ${
                  platform === p ? "bg-accent text-white" : "text-paper-2 hover:text-paper"
                }`}
              >
                {p === "youtube" ? "YouTube" : "TikTok"}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <select
            value={aestheticId ?? ""}
            onChange={(e) => setAestheticId(e.target.value || null)}
            className={`${selectCls} min-w-[160px]`}
          >
            <option value="">No aesthetic</option>
            {aesthetics.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

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

          <motion.button
            onClick={() => scrape.mutate()}
            disabled={!query.trim() || scrape.isPending}
            whileTap={{ scale: 0.97 }}
            className="bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold px-5 py-2 disabled:opacity-30 hover:bg-accent-dark transition-colors"
          >
            {scrape.isPending ? "Scraping…" : "Scrape"}
          </motion.button>
        </div>

        <AnimatePresence>
          {scrapeError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 font-data text-xs text-accent overflow-hidden"
            >
              {scrapeError}
            </motion.p>
          )}
          {scrapeResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 font-data text-xs text-paper-2 flex flex-wrap gap-x-4 gap-y-1 overflow-hidden"
            >
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
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* video grid */}
      {isLoading ? (
        <p className="font-data text-xs text-paper-2">Loading…</p>
      ) : videos.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="font-data text-xs text-paper-3"
        >
          No videos yet. Use the scraper above to find footage.
        </motion.p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {videos.map((v, i) => (
            <VideoCard key={v.id} video={v} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
