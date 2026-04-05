"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, AnimatePresence, type Variants } from "framer-motion";
import { getAnalyticsSummary, getAllDistributions, type Distribution } from "@/lib/api";

// counts up from 0 to `target` using a spring, updating a display value each frame
function useAnimatedCounter(target: number, enabled: boolean) {
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { stiffness: 60, damping: 20 });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    motionVal.set(target);
  }, [target, enabled]);

  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplay(Math.round(v)));
    return unsub;
  }, [spring]);

  return display;
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3, ease: [0.25, 0, 0, 1] },
  }),
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.06, duration: 0.25, ease: [0.25, 0, 0, 1] },
  }),
};

function StatCard({ label, value, index, enabled }: { label: string; value: number; index: number; enabled: boolean }) {
  const display = useAnimatedCounter(value, enabled);
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="border border-sub p-5"
    >
      <p className="font-display text-xs text-paper-2 tracking-[0.2em] uppercase mb-2">{label}</p>
      <p className="font-data text-3xl font-medium tabular-nums">{display.toLocaleString()}</p>
    </motion.div>
  );
}

function AnimatedBar({ width, color }: { width: number; color: string }) {
  return (
    <div className="bg-sub h-px relative overflow-hidden">
      <motion.div
        className="h-px absolute left-0 top-0"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(width, 100)}%` }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
      />
    </div>
  );
}

function EngagementBar({ dist }: { dist: Distribution }) {
  const views = dist.view_count ?? 0;
  const likes = dist.like_count ?? 0;
  const shares = dist.share_count ?? 0;
  const maxViews = views || 1;

  return (
    <div className="flex gap-4 mt-2">
      <div className="flex-1">
        <div className="flex justify-between font-data text-xs text-paper-3 mb-1">
          <span>Likes</span>
          <span>{likes.toLocaleString()}</span>
        </div>
        <AnimatedBar width={Math.round((likes / maxViews) * 100)} color="var(--accent)" />
      </div>
      <div className="flex-1">
        <div className="flex justify-between font-data text-xs text-paper-3 mb-1">
          <span>Shares</span>
          <span>{shares.toLocaleString()}</span>
        </div>
        <AnimatedBar width={Math.round((shares / maxViews) * 100)} color="#4a3f30" />
      </div>
    </div>
  );
}

function DistributionRow({ dist, index }: { dist: Distribution; index: number }) {
  const statusColor =
    dist.status === "posted"
      ? "text-accent"
      : dist.status === "error"
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <motion.div
      custom={index}
      variants={rowVariants}
      initial="hidden"
      animate="visible"
      className="border-b border-sub px-4 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <motion.span
              className={`font-display text-xs tracking-[0.12em] uppercase shrink-0 ${statusColor}`}
              animate={dist.status === "pending" ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
              transition={dist.status === "pending" ? { duration: 1.4, repeat: Infinity } : {}}
            >
              {dist.status}
            </motion.span>
            {dist.song_title && (
              <Link
                href={`/songs/${dist.song_id}`}
                className="font-display text-sm font-semibold tracking-wide hover:text-accent transition-colors truncate uppercase"
              >
                {dist.song_title}
              </Link>
            )}
          </div>
          {dist.caption && (
            <p className="font-data text-xs text-paper-2 mt-1.5 line-clamp-2 italic">{dist.caption}</p>
          )}
          {dist.status === "posted" && <EngagementBar dist={dist} />}
          {dist.error_message && (
            <p className="font-data text-xs text-red-400 mt-1">{dist.error_message}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-data text-xs text-paper-3">{new Date(dist.created_at).toLocaleDateString()}</p>
          {dist.view_count !== null && (
            <>
              <p className="font-data text-xl font-medium tabular-nums mt-1">{(dist.view_count ?? 0).toLocaleString()}</p>
              <p className="font-data text-xs text-paper-2">views</p>
            </>
          )}
          {dist.metrics_fetched_at && (
            <p className="font-data text-xs text-paper-3 mt-1">
              synced {new Date(dist.metrics_fetched_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function AnalyticsPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: getAnalyticsSummary,
    refetchInterval: 60_000,
  });

  const { data: distributions, isLoading: distsLoading } = useQuery({
    queryKey: ["all-distributions"],
    queryFn: getAllDistributions,
    refetchInterval: 30_000,
  });

  const statsReady = !!summary && !summaryLoading;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Analytics</h1>
        <div className="h-[2px] w-8 bg-accent mt-2 mb-2" />
        <p className="font-data text-xs text-paper-2 mb-8">Performance metrics across all posts. Synced hourly.</p>
      </motion.div>

      {summaryLoading && <p className="font-data text-xs text-paper-2">Loading…</p>}

      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard label="Posts" value={summary.total_posts} index={0} enabled={statsReady} />
            <StatCard label="Views" value={summary.total_views} index={1} enabled={statsReady} />
            <StatCard label="Likes" value={summary.total_likes} index={2} enabled={statsReady} />
            <StatCard label="Shares" value={summary.total_shares} index={3} enabled={statsReady} />
          </div>

          <AnimatePresence>
            {summary.best_performing && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.32 }}
                className="border border-sub p-5 mb-8"
              >
                <p className="font-display text-xs text-paper-2 tracking-[0.2em] uppercase mb-3">Top Post</p>
                <p className="font-display text-xl font-semibold tracking-wide uppercase">
                  {summary.best_performing.song_title ?? "Untitled"}
                </p>
                <div className="flex gap-6 mt-2">
                  <span className="font-data text-sm">
                    <span className="text-paper tabular-nums">{(summary.best_performing.view_count ?? 0).toLocaleString()}</span>
                    <span className="text-paper-3 ml-1.5">views</span>
                  </span>
                  <span className="font-data text-sm">
                    <span className="text-paper tabular-nums">{(summary.best_performing.like_count ?? 0).toLocaleString()}</span>
                    <span className="text-paper-3 ml-1.5">likes</span>
                  </span>
                  <span className="font-data text-sm">
                    <span className="text-paper tabular-nums">{(summary.best_performing.share_count ?? 0).toLocaleString()}</span>
                    <span className="text-paper-3 ml-1.5">shares</span>
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <motion.h2
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="font-display text-xs tracking-[0.2em] uppercase text-paper-2 mb-0"
      >
        All Posts
      </motion.h2>
      <div className="border-t border-sub mt-3">
        {distsLoading && <p className="font-data text-xs text-paper-2 px-4 py-4">Loading…</p>}

        {!distsLoading && distributions?.length === 0 && (
          <p className="font-data text-xs text-paper-3 px-4 py-4">
            No posts yet.{" "}
            <Link href="/songs" className="text-paper-2 hover:text-accent transition-colors underline underline-offset-2">
              Upload a song
            </Link>{" "}
            and render a video to get started.
          </p>
        )}

        {distributions?.map((d, i) => (
          <DistributionRow key={d.id} dist={d} index={i} />
        ))}
      </div>
    </div>
  );
}
