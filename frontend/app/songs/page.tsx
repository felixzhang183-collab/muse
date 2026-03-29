"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getSongs, type SongListItem } from "@/lib/api";

const STATUS_TEXT: Record<string, string> = {
  uploaded: "text-paper-2",
  analyzing: "text-yellow-400 animate-pulse",
  analyzed: "text-accent",
  error: "text-red-400",
};

const STATUS_DOT: Record<string, string> = {
  uploaded: "bg-paper-3",
  analyzing: "bg-yellow-400 animate-pulse",
  analyzed: "bg-accent",
  error: "bg-red-500",
};

function SongRow({ song }: { song: SongListItem }) {
  const mins = song.duration_sec ? Math.floor(song.duration_sec / 60) : null;
  const secs = song.duration_sec ? Math.floor(song.duration_sec % 60) : null;
  const dur = mins !== null ? `${mins}:${String(secs).padStart(2, "0")}` : "—";

  return (
    <Link
      href={`/songs/${song.id}`}
      className="group flex items-center gap-5 px-4 py-4 border-b border-sub hover:bg-surface transition-colors"
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[song.status] ?? "bg-paper-3"}`} />
      <div className="flex-1 min-w-0">
        <p className="font-display text-base font-semibold tracking-wide group-hover:text-white transition-colors truncate uppercase">
          {song.title}
        </p>
        <p className="text-xs text-paper-3 mt-0.5 truncate font-data">{song.file_name}</p>
      </div>
      <span className={`font-display text-xs tracking-[0.12em] uppercase shrink-0 ${STATUS_TEXT[song.status] ?? "text-paper-2"}`}>
        {song.status}
      </span>
      <span className="font-data text-xs text-paper-2 w-10 text-right tabular-nums shrink-0">{dur}</span>
      <span className="font-data text-xs text-paper-2 w-16 text-right tabular-nums shrink-0">
        {song.bpm ? `${Math.round(song.bpm)} bpm` : "—"}
      </span>
    </Link>
  );
}

export default function SongsPage() {
  const { data: songs, isLoading, error } = useQuery({
    queryKey: ["songs"],
    queryFn: getSongs,
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Songs</h1>
          <div className="h-[2px] w-8 bg-accent mt-2" />
        </div>
        <Link
          href="/songs/upload"
          className="px-5 py-2.5 bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold hover:bg-accent-dark transition-colors"
        >
          + Upload
        </Link>
      </div>

      {isLoading && (
        <p className="font-data text-xs text-paper-2 tracking-wider">Loading…</p>
      )}

      {error && (
        <p className="font-data text-xs text-accent border border-accent/30 bg-accent/5 px-4 py-3">
          Failed to load songs. Make sure you are logged in.
        </p>
      )}

      {songs && songs.length === 0 && (
        <div className="py-20 text-center border border-sub">
          <p className="font-display text-xs text-paper-2 tracking-[0.15em] uppercase mb-4">No tracks yet</p>
          <Link
            href="/songs/upload"
            className="font-display text-xs text-paper hover:text-accent transition-colors tracking-[0.15em] uppercase underline underline-offset-4"
          >
            Upload your first track →
          </Link>
        </div>
      )}

      {songs && songs.length > 0 && (
        <div className="border-t border-sub">
          {songs.map((s) => (
            <SongRow key={s.id} song={s} />
          ))}
        </div>
      )}
    </div>
  );
}
