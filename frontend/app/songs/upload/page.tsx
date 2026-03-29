"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { uploadSong } from "@/lib/api";

const inputCls =
  "w-full bg-surface border border-sub px-3 py-2.5 text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors font-data";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Upload Track</h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-8" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className={`border px-8 py-14 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-accent bg-accent/5"
              : "border-sub hover:border-paper-3"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {file ? (
            <div>
              <p className="font-display text-xl tracking-wider uppercase text-paper">{file.name}</p>
              <p className="font-data text-xs text-paper-2 mt-2">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          ) : (
            <div>
              <p className="font-data text-sm text-paper-2">Drop a file here or click to browse</p>
              <p className="font-data text-xs text-paper-3 mt-2">{ACCEPTED.join("  ")}</p>
            </div>
          )}
        </div>

        <div>
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
        </div>

        {error && (
          <p className="font-data text-xs text-accent border border-accent/30 bg-accent/5 px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={!file || uploading}
          className="px-5 py-3 bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold disabled:opacity-30 hover:bg-accent-dark transition-colors"
        >
          {uploading ? "Uploading…" : "Upload & Analyze"}
        </button>
      </form>
    </div>
  );
}
