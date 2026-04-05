"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { memo, useCallback } from "react";
import { motion, type Variants } from "framer-motion";
import { getSongs, type SongListItem } from "@/lib/api";

const STATUS_TEXT: Record<string, string> = {
  uploaded: "text-paper-2",
  analyzing: "text-yellow-400",
  analyzed: "text-accent",
  error: "text-red-400",
};

const STATUS_DOT_COLOR: Record<string, string> = {
  uploaded: "#6b5f50",
  analyzing: "#facc15",
  analyzed: "#c49a6c",
  error: "#f87171",
};

const listVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.25, ease: [0.25, 0, 0, 1] } },
};

const SongRow = memo(function SongRow({ song }: { song: SongListItem }) {
  const mins = song.duration_sec ? Math.floor(song.duration_sec / 60) : null;
  const secs = song.duration_sec ? Math.floor(song.duration_sec % 60) : null;
  const dur = mins !== null ? `${mins}:${String(secs).padStart(2, "0")}` : "—";
  const dotColor = STATUS_DOT_COLOR[song.status] ?? "#6b5f50";
  const isAnalyzing = song.status === "analyzing";

  return (
    <motion.div variants={rowVariants}>
      <Link
        href={`/songs/${song.id}`}
        className="group flex items-center gap-5 px-4 py-4 border-b border-sub hover:bg-surface transition-colors"
      >
        {/* status dot — framer-motion pulse for analyzing, static otherwise */}
        <motion.div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
          animate={isAnalyzing ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
          transition={isAnalyzing ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : {}}
        />
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
    </motion.div>
  );
});

export default function SongsPage() {
  const fetchSongs = useCallback(() => getSongs(), []);

  const { data: songs, isLoading, error } = useQuery({
    queryKey: ["songs"],
    queryFn: fetchSongs,
  });

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex items-end justify-between mb-8"
      >
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
      </motion.div>

      {isLoading && (
        <p className="font-data text-xs text-paper-2 tracking-wider">Loading…</p>
      )}

      {error && (
        <p className="font-data text-xs text-accent border border-accent/30 bg-accent/5 px-4 py-3">
          Failed to load songs. Make sure you are logged in.
        </p>
      )}

      {songs && songs.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="py-20 text-center border border-sub"
        >
          <p className="font-display text-xs text-paper-2 tracking-[0.15em] uppercase mb-4">No tracks yet</p>
          <Link
            href="/songs/upload"
            className="font-display text-xs text-paper hover:text-accent transition-colors tracking-[0.15em] uppercase underline underline-offset-4"
          >
            Upload your first track →
          </Link>
        </motion.div>
      )}

      {songs && songs.length > 0 && (
        <motion.div
          className="border-t border-sub"
          variants={listVariants}
          initial="hidden"
          animate="visible"
        >
          {songs.map((s) => (
            <SongRow key={s.id} song={s} />
          ))}
        </motion.div>
      )}
    </div>
  );
}
