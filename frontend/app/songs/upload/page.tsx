"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { uploadSong } from "@/lib/api";

const inputCls =
  "w-full bg-surface border border-sub px-3 py-2.5 text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors font-data";

// animated waveform bars shown while uploading
function WaveformLoader() {
  return (
    <div className="flex items-end gap-[3px] h-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] bg-white rounded-sm"
          animate={{ height: ["6px", "22px", "6px"] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.07,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // mouse position for drop zone radial glow
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const dropRef = useRef<HTMLDivElement>(null);
  const glowBg = useTransform(
    [mouseX, mouseY],
    ([x, y]: number[]) =>
      `radial-gradient(180px circle at ${x}px ${y}px, rgba(196,154,108,0.1), transparent)`
  );

  const ACCEPTED = [".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg"];

  function handleFile(f: File) {
    const ext = "." + f.name.split(".").pop()!.toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setError(`Unsupported format. Accepted: ${ACCEPTED.join(", ")}`);
      return;
    }
    setFile(f);
    setError(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = dropRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { song_id } = await uploadSong(file, title || undefined);
      router.push(`/songs/${song_id}`);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
      setUploading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Upload Track</h1>
        <div className="h-[2px] w-8 bg-accent mt-2 mb-8" />
      </motion.div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* drop zone with radial glow that follows the mouse */}
        <motion.div
          ref={dropRef}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={dragging
            ? { opacity: 1, scale: 1.02, borderColor: "var(--accent)" }
            : { opacity: 1, scale: 1 }
          }
          transition={{ duration: 0.25 }}
          onClick={() => inputRef.current?.click()}
          onMouseMove={handleMouseMove}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className="relative border border-sub px-8 py-14 text-center cursor-pointer overflow-hidden"
        >
          {/* radial spotlight following cursor */}
          <motion.div
            className="pointer-events-none absolute inset-0"
            style={{ background: glowBg }}
          />

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          <AnimatePresence mode="wait">
            {file ? (
              <motion.div
                key="file"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <p className="font-display text-xl tracking-wider uppercase text-paper">{file.name}</p>
                <p className="font-data text-xs text-paper-2 mt-2">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                <p className="font-data text-sm text-paper-2">Drop a file here or click to browse</p>
                <p className="font-data text-xs text-paper-3 mt-2">{ACCEPTED.join("  ")}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
        >
          <label className="block font-display text-xs text-paper-2 mb-1.5 tracking-[0.15em] uppercase">
            Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Track title"
            className={inputCls}
          />
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="font-data text-xs text-accent border border-accent/30 bg-accent/5 px-3 py-2 overflow-hidden"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.25 }}
          type="submit"
          disabled={!file || uploading}
          whileTap={{ scale: 0.98 }}
          className="px-5 py-3 bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold disabled:opacity-30 hover:bg-accent-dark transition-colors flex items-center justify-center gap-3 min-h-[44px]"
        >
          <AnimatePresence mode="wait">
            {uploading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3"
              >
                <WaveformLoader />
                <span>Uploading</span>
              </motion.div>
            ) : (
              <motion.span
                key="label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Upload &amp; Analyze
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </form>
    </div>
  );
}
