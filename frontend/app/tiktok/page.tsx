"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTikTokStatus, getTikTokAuthUrl, disconnectTikTok } from "@/lib/api";

export default function TikTokPage() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["tiktok-status"],
    queryFn: getTikTokStatus,
  });

  const { mutate: connect, isPending: isConnecting } = useMutation({
    mutationFn: async () => {
      const { url } = await getTikTokAuthUrl();
      window.location.href = url;
    },
  });

  const { mutate: disconnect, isPending: isDisconnecting } = useMutation({
    mutationFn: disconnectTikTok,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tiktok-status"] }),
  });

  return (
    <div>
      <h1 className="font-display text-5xl font-bold tracking-wider uppercase">TikTok</h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-2" />
      <p className="font-data text-xs text-paper-2 mb-10">
        Connect your account to post beat-synced edits directly from the app.
      </p>

      {isLoading && <p className="font-data text-xs text-paper-2">Loading…</p>}

      {!isLoading && (
        <div className="border border-sub p-6 max-w-sm">
          <div className="flex items-center gap-3 mb-6">
            <div
              className={`w-2 h-2 shrink-0 ${status?.connected ? "bg-accent" : "bg-paper-3"}`}
            />
            <span className="font-display text-sm tracking-wider uppercase">
              {status?.connected ? "Connected" : "Not connected"}
            </span>
            {status?.open_id && (
              <span className="font-data text-xs text-paper-3 ml-auto truncate max-w-[110px]">
                {status.open_id}
              </span>
            )}
          </div>

          {status?.connected ? (
            <button
              onClick={() => disconnect()}
              disabled={isDisconnecting}
              className="w-full font-display text-xs tracking-[0.15em] uppercase bg-surface border border-sub text-paper-2 px-4 py-3 hover:border-paper-2 hover:text-paper transition-colors disabled:opacity-50"
            >
              {isDisconnecting ? "Disconnecting…" : "Disconnect TikTok"}
            </button>
          ) : (
            <button
              onClick={() => connect()}
              disabled={isConnecting}
              className="w-full font-display text-xs tracking-[0.15em] uppercase bg-accent text-white font-bold px-4 py-3 hover:bg-accent-dark transition-colors disabled:opacity-50"
            >
              {isConnecting ? "Redirecting…" : "Connect TikTok"}
            </button>
          )}

          {!status?.connected && (
            <p className="font-data text-xs text-paper-3 mt-3">
              You&apos;ll be redirected to TikTok to authorize posting access.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
