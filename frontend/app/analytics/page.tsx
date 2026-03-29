"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getAnalyticsSummary, getAllDistributions, type Distribution } from "@/lib/api";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-sub p-5">
      <p className="font-display text-xs text-paper-2 tracking-[0.2em] uppercase mb-2">{label}</p>
      <p className="font-data text-3xl font-medium tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function EngagementBar({ dist }: { dist: Distribution }) {
  const views = dist.view_count ?? 0;
  const likes = dist.like_count ?? 0;
  const shares = dist.share_count ?? 0;
  const maxViews = views || 1;
  const likeWidth = Math.round((likes / maxViews) * 100);
  const shareWidth = Math.round((shares / maxViews) * 100);

  return (
    <div className="flex gap-4 mt-2">
      <div className="flex-1">
        <div className="flex justify-between font-data text-xs text-paper-3 mb-1">
          <span>Likes</span>
          <span>{likes.toLocaleString()}</span>
        </div>
        <div className="bg-sub h-px">
          <div className="bg-accent h-px" style={{ width: `${Math.min(likeWidth, 100)}%` }} />
        </div>
      </div>
      <div className="flex-1">
        <div className="flex justify-between font-data text-xs text-paper-3 mb-1">
          <span>Shares</span>
          <span>{shares.toLocaleString()}</span>
        </div>
        <div className="bg-sub h-px">
          <div className="bg-paper-2 h-px" style={{ width: `${Math.min(shareWidth, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function DistributionRow({ dist }: { dist: Distribution }) {
  const statusColor =
    dist.status === "posted"
      ? "text-accent"
      : dist.status === "error"
      ? "text-red-400"
      : "text-yellow-400 animate-pulse";

  return (
    <div className="border-b border-sub px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`font-display text-xs tracking-[0.12em] uppercase shrink-0 ${statusColor}`}>
              {dist.status}
            </span>
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
    </div>
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

  return (
    <div>
      <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Analytics</h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-2" />
      <p className="font-data text-xs text-paper-2 mb-8">Performance metrics across all posts. Synced hourly.</p>

      {summaryLoading && <p className="font-data text-xs text-paper-2">Loading…</p>}

      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <StatCard label="Posts" value={summary.total_posts} />
            <StatCard label="Views" value={summary.total_views} />
            <StatCard label="Likes" value={summary.total_likes} />
            <StatCard label="Shares" value={summary.total_shares} />
          </div>

          {summary.best_performing && (
            <div className="border border-sub p-5 mb-8">
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
            </div>
          )}
        </>
      )}

      <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper-2 mb-0">All Posts</h2>
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

        {distributions?.map((d) => <DistributionRow key={d.id} dist={d} />)}
      </div>
    </div>
  );
}
