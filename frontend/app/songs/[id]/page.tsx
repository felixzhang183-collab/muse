"use client";

import React from "react";
import { motion, AnimatePresence, useMotionValue, useSpring } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  getSong, getJob, getAesthetics, getRenders, getRender, getRenderDownloadUrl,
  distributeRender, getDistribution, getTikTokStatus, updateSectionMarkers, transcribeSongLyrics, updateLyricsLines,
  getStreamUrl, getSectionTemplates, createSectionTemplate, deleteSectionTemplate,
  getDrafts, createDraft, updateDraft, deleteDraft, renderFromDraft, getAesthetic, saveDraftAsTemplate,
  getDraftTemplates, createDraftFromTemplate, deleteDraftTemplate,
  type Song, type Render, type Distribution, type SectionTemplate, type Draft, type DraftAssignment, type LyricLine, type LyricStyle, type DraftTemplate,
} from "@/lib/api";

const SECTION_LABELS = [
  "intro", "verse", "pre-chorus", "chorus", "build", "drop", "bridge", "break", "outro",
];
const SECTION_COLORS = [
  "bg-violet-900/60 border-violet-700",
  "bg-blue-900/60 border-blue-700",
  "bg-cyan-900/60 border-cyan-700",
  "bg-teal-900/60 border-teal-700",
  "bg-emerald-900/60 border-emerald-700",
  "bg-amber-900/60 border-amber-700",
  "bg-orange-900/60 border-orange-700",
  "bg-rose-900/60 border-rose-700",
  "bg-pink-900/60 border-pink-700",
];
const DOT_COLORS = [
  "bg-violet-500", "bg-blue-500", "bg-cyan-500", "bg-teal-500",
  "bg-emerald-500", "bg-amber-500", "bg-orange-500", "bg-rose-500", "bg-pink-500",
];
const MIN_SEC = 2;
const SNAP_RADIUS_SEC = 0.3;

function snapToBeats(time: number, beats: number[]): number {
  if (beats.length === 0) return time;
  let closest = time;
  let minDist = SNAP_RADIUS_SEC;
  for (const b of beats) {
    const d = Math.abs(b - time);
    if (d < minDist) { minDist = d; closest = b; }
  }
  return closest;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SectionEditor({ song }: { song: Song }) {
  const duration = song.duration_sec ?? 0;
  const queryClient = useQueryClient();

  // ── Section state ──────────────────────────────────────────────────────────
  const [cuts, setCuts] = React.useState<number[]>(() => {
    const m = song.section_markers ?? [];
    return m.slice(0, -1).map((s) => s.end);
  });
  const [labels, setLabels] = React.useState<string[]>(() => {
    const m = song.section_markers ?? [];
    return m.length > 0 ? m.map((s) => s.label) : ["intro"];
  });

  // ── Refs for stable closures ───────────────────────────────────────────────
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ index: number; startX: number; startCut: number } | null>(null);
  const cutsRef = React.useRef(cuts);
  cutsRef.current = cuts;
  const durationRef = React.useRef(duration);
  durationRef.current = duration;

  // ── Beat snap ─────────────────────────────────────────────────────────────
  const [snapEnabled, setSnapEnabled] = React.useState(true);
  const snapRef = React.useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const beatsRef = React.useRef<number[]>(song.beat_timestamps ?? []);

  // ── Audio playback ────────────────────────────────────────────────────────
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const rafRef = React.useRef<number>(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);

  // ── Web Audio API — live waveform visualizer ──────────────────────────────
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const sourceConnectedRef = React.useRef(false);
  const vizRafRef = React.useRef<number>(0);

  const startVisualizer = React.useCallback(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return;

    // create audio context + analyser once
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      if (!sourceConnectedRef.current) {
        const source = ctx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        sourceConnectedRef.current = true;
      }
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }

    const analyser = analyserRef.current!;
    const bufLen = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);
    const ctx2d = canvas.getContext("2d")!;

    const draw = () => {
      vizRafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArr);

      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      const barCount = Math.min(bufLen, 40);
      const barW = (w / barCount) * 0.6;
      const gap = (w / barCount) * 0.4;

      for (let i = 0; i < barCount; i++) {
        const val = dataArr[i] / 255;
        const barH = Math.max(2, val * h * 0.9);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;

        // colour shifts from accent to white based on amplitude
        const r = Math.round(196 + (255 - 196) * val);
        const g = Math.round(154 + (255 - 154) * val);
        const b = Math.round(108 + (255 - 108) * val);
        ctx2d.fillStyle = `rgb(${r},${g},${b})`;
        ctx2d.fillRect(x, y, barW, barH);
      }
    };
    draw();
  }, []);

  const stopVisualizer = React.useCallback(() => {
    cancelAnimationFrame(vizRafRef.current);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx2d = canvas.getContext("2d");
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // clean up on unmount
  React.useEffect(() => () => {
    cancelAnimationFrame(vizRafRef.current);
    audioCtxRef.current?.close();
  }, []);

  const { data: streamUrl } = useQuery({
    queryKey: ["stream-url", song.id],
    queryFn: () => getStreamUrl(song.id),
    staleTime: 50 * 60 * 1000,
  });

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    audio.src = streamUrl;
    const handleError = () => {
      queryClient.invalidateQueries({ queryKey: ["stream-url", song.id] });
    };
    audio.addEventListener("error", handleError);
    return () => audio.removeEventListener("error", handleError);
  }, [streamUrl, song.id, queryClient]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      stopVisualizer();
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, []);

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const startRaf = () => {
    const tick = () => {
      setCurrentTime(audioRef.current?.currentTime ?? 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
      startRaf();
      startVisualizer();
    } else {
      audio.pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      stopVisualizer();
    }
  };

  // ── Template state ────────────────────────────────────────────────────────
  const [templateName, setTemplateName] = React.useState("");
  const [showTemplateSave, setShowTemplateSave] = React.useState(false);

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ["section-templates"],
    queryFn: getSectionTemplates,
  });

  const { mutate: saveTemplate, isPending: isSavingTemplate } = useMutation({
    mutationFn: () =>
      createSectionTemplate({
        name: templateName.trim(),
        cuts_ratio: cuts.map((c) => c / duration),
        labels,
      }),
    onSuccess: () => {
      refetchTemplates();
      setTemplateName("");
      setShowTemplateSave(false);
    },
  });

  const { mutate: removeTemplate } = useMutation({
    mutationFn: (id: string) => deleteSectionTemplate(id),
    onSuccess: () => refetchTemplates(),
  });

  const loadTemplate = (t: SectionTemplate) => {
    let newCuts = t.cuts_ratio.map((r) => r * duration);
    if (snapEnabled) {
      newCuts = newCuts.map((c) => snapToBeats(c, beatsRef.current));
    }
    // Enforce MIN_SEC spacing left-to-right
    for (let i = 1; i < newCuts.length; i++) {
      newCuts[i] = Math.max(newCuts[i], newCuts[i - 1] + MIN_SEC);
    }
    newCuts = newCuts
      .map((c) => Math.round(c * 10) / 10)
      .filter((c) => c > 0 && c < duration);
    setCuts(newCuts);
    setLabels([...t.labels]);
  };

  // ── Derived sections ──────────────────────────────────────────────────────
  const sections = React.useMemo(() => {
    const times = [0, ...cuts, duration];
    return times.slice(0, -1).map((start, i) => ({
      start,
      end: times[i + 1],
      label: labels[i] ?? SECTION_LABELS[i % SECTION_LABELS.length],
    }));
  }, [cuts, labels, duration]);

  // ── Drag handles ──────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    e.preventDefault();
    dragRef.current = { index, startX: e.clientX, startCut: cutsRef.current[index] };

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current || !timelineRef.current) return;
      const { index: idx, startX, startCut } = dragRef.current;
      const dur = durationRef.current;
      const cc = cutsRef.current;
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaSec = ((ev.clientX - startX) / rect.width) * dur;
      const minLeft = (idx > 0 ? cc[idx - 1] : 0) + MIN_SEC;
      const maxRight = (idx < cc.length - 1 ? cc[idx + 1] : dur) - MIN_SEC;
      const raw = Math.max(minLeft, Math.min(maxRight, startCut + deltaSec));
      const snapped = snapRef.current ? snapToBeats(raw, beatsRef.current) : raw;
      const finalCut = Math.max(minLeft, Math.min(maxRight, snapped));
      setCuts((prev) => {
        const next = [...prev];
        next[idx] = Math.round(finalCut * 10) / 10;
        return next;
      });
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Timeline click-to-seek ────────────────────────────────────────────────
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (dragRef.current || !timelineRef.current || !audioRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const seekTime = ((e.clientX - rect.left) / rect.width) * duration;
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  // ── Add / remove / delete cuts ────────────────────────────────────────────
  const addCut = (sectionIndex: number) => {
    const sec = sections[sectionIndex];
    if (sec.end - sec.start < MIN_SEC * 2) return;
    const mid = Math.round(((sec.start + sec.end) / 2) * 10) / 10;
    setCuts((prev) => { const n = [...prev]; n.splice(sectionIndex, 0, mid); return n; });
    setLabels((prev) => {
      const n = [...prev];
      n.splice(sectionIndex + 1, 0, SECTION_LABELS[(sectionIndex + 1) % SECTION_LABELS.length]);
      return n;
    });
  };

  const removeCut = (cutIndex: number) => {
    setCuts((prev) => prev.filter((_, i) => i !== cutIndex));
    setLabels((prev) => prev.filter((_, i) => i !== cutIndex + 1));
  };

  const deleteSection = (i: number) => {
    if (sections.length <= 1) return;
    if (i === 0) {
      setCuts((prev) => prev.slice(1));
      setLabels((prev) => prev.slice(1));
    } else {
      setCuts((prev) => prev.filter((_, j) => j !== i - 1));
      setLabels((prev) => prev.filter((_, j) => j !== i));
    }
  };

  // ── Save sections ─────────────────────────────────────────────────────────
  const { mutate: save, isPending, isSuccess } = useMutation({
    mutationFn: () => updateSectionMarkers(song.id, sections),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["song", song.id] }),
  });

  if (!duration) return null;

  // Beat ticks: render every 2nd beat if song has many beats
  const beatTicks = beatsRef.current;
  const tickStep = beatTicks.length > 200 ? 2 : 1;

  return (
    <div className="space-y-3">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      {/* Timeline */}
      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        className="relative h-16 bg-sub rounded-lg overflow-hidden select-none cursor-pointer"
      >
        {/* Beat ticks */}
        {beatTicks.filter((_, i) => i % tickStep === 0).map((b, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-paper/10 pointer-events-none"
            style={{ left: `${(b / duration) * 100}%` }}
          />
        ))}

        {/* Section blocks */}
        {sections.map((sec, i) => {
          const left = (sec.start / duration) * 100;
          const width = ((sec.end - sec.start) / duration) * 100;
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 border-r ${SECTION_COLORS[i % SECTION_COLORS.length]}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center px-1 overflow-hidden pointer-events-none">
                <span className="text-[11px] font-medium text-paper/75 capitalize truncate max-w-full leading-tight">
                  {sec.label}
                </span>
                <span className="text-[9px] text-paper/35 leading-tight">
                  {(sec.end - sec.start).toFixed(1)}s
                </span>
              </div>
            </div>
          );
        })}

        {/* Drag handles */}
        {cuts.map((cut, i) => (
          <div
            key={i}
            onPointerDown={(e) => handlePointerDown(e, i)}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize z-10 group flex items-center justify-center"
            style={{ left: `${(cut / duration) * 100}%` }}
          >
            <div className="absolute inset-y-0 w-0.5 bg-paper/40 group-hover:bg-paper transition-colors" />
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); removeCut(i); }}
              className="relative w-4 h-4 rounded-full bg-paper-3 border border-paper-3 text-paper text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-700 transition-all"
            >
              ×
            </button>
          </div>
        ))}

        {/* Playhead — framer-motion so it glides smoothly */}
        <motion.div
          className="absolute top-0 bottom-0 w-px bg-paper z-20 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
          animate={{ left: `${(currentTime / duration) * 100}%` }}
          transition={{ duration: 0.05, ease: "linear" }}
        >
          {/* small triangle handle at top of playhead */}
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-paper rotate-45" />
        </motion.div>

        {/* active section pulse overlay */}
        {isPlaying && sections.map((sec, i) => {
          const isActive = currentTime >= sec.start && currentTime < sec.end;
          if (!isActive) return null;
          return (
            <motion.div
              key={i}
              className="absolute top-0 bottom-0 pointer-events-none z-10"
              style={{
                left: `${(sec.start / duration) * 100}%`,
                width: `${((sec.end - sec.start) / duration) * 100}%`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.15, 0.3, 0.15] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="absolute inset-0 bg-white/10 rounded-sm" />
            </motion.div>
          );
        })}
      </div>

      {/* Audio controls */}
      <div className="flex items-center gap-3">
        {/* animated play/pause button */}
        <motion.button
          onClick={togglePlayback}
          disabled={!streamUrl}
          whileTap={{ scale: 0.88 }}
          animate={isPlaying ? { scale: [1, 1.08, 1] } : { scale: 1 }}
          transition={isPlaying ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
          className="w-9 h-9 rounded-full bg-accent hover:bg-accent-dark flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
        >
          <AnimatePresence mode="wait">
            {isPlaying ? (
              <motion.div
                key="pause"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex gap-[3px] items-center"
              >
                <span className="w-[3px] h-3.5 bg-white rounded-sm block" />
                <span className="w-[3px] h-3.5 bg-white rounded-sm block" />
              </motion.div>
            ) : (
              <motion.div
                key="play"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="text-white text-sm ml-0.5"
              >
                ▶
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>

        {/* live waveform canvas — only visible while playing */}
        <AnimatePresence>
          {isPlaying && (
            <motion.canvas
              ref={canvasRef}
              width={160}
              height={36}
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 160 }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.3 }}
              className="shrink-0"
            />
          )}
        </AnimatePresence>

        <span className="text-xs text-paper-3 tabular-nums font-data">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button
          onClick={() => setSnapEnabled((v) => !v)}
          title="Snap to beat"
          className={`text-xs px-2 py-1 rounded-md transition-colors ${
            snapEnabled ? "bg-paper-2 text-white" : "bg-sub text-paper-3"
          }`}
        >
          ♩ Snap
        </button>
      </div>

      {/* Section pills */}
      <div className="flex gap-1.5 flex-wrap">
        {sections.map((sec, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-sub rounded-lg px-2.5 py-1.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLORS[i % DOT_COLORS.length]}`} />
            <select
              value={sec.label}
              onChange={(e) =>
                setLabels((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })
              }
              className="bg-transparent text-xs text-paper focus:outline-none cursor-pointer"
            >
              {SECTION_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <span className="text-[10px] text-paper-3">
              {sec.start.toFixed(0)}–{sec.end.toFixed(0)}s
            </span>
            <button
              onClick={() => addCut(i)}
              title="Split this section"
              className="text-paper-3 hover:text-paper transition-colors text-sm leading-none"
            >
              +
            </button>
            <button
              onClick={() => deleteSection(i)}
              disabled={sections.length <= 1}
              title="Delete section"
              className="text-paper-3 hover:text-red-400 transition-colors text-xs leading-none disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Toolbar: save, templates */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => save()}
          disabled={isPending}
          className="text-sm bg-paper text-ink font-medium rounded-lg px-4 py-1.5 hover:bg-surface transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save Sections"}
        </button>
        {isSuccess && <span className="text-xs text-green-400">Saved</span>}

        <div className="h-4 w-px bg-paper-3" />

        {/* Save as template */}
        {showTemplateSave ? (
          <div className="flex items-center gap-1.5">
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && templateName.trim() && saveTemplate()}
              placeholder="Template name…"
              autoFocus
              className="bg-sub rounded-md px-2 py-1 text-xs text-paper placeholder-paper-3 focus:outline-none focus:ring-1 focus:ring-paper/20 w-36"
            />
            <button
              onClick={() => templateName.trim() && saveTemplate()}
              disabled={!templateName.trim() || isSavingTemplate}
              className="text-xs bg-paper-3 hover:bg-paper-2 text-ink rounded-md px-2 py-1 transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => { setShowTemplateSave(false); setTemplateName(""); }}
              className="text-xs text-paper-3 hover:text-paper transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowTemplateSave(true)}
            className="text-xs text-paper-3 hover:text-paper transition-colors"
          >
            Save as template
          </button>
        )}

        {/* Load template */}
        {templates.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t) loadTemplate(t);
              e.target.value = "";
            }}
            className="bg-sub rounded-md px-2 py-1 text-xs text-paper-2 focus:outline-none cursor-pointer"
          >
            <option value="" disabled>Load template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Template list for deletion */}
      {templates.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-1 bg-sub/50 rounded-md px-2 py-1">
              <span className="text-[10px] text-paper-3">{t.name}</span>
              <button
                onClick={() => removeTemplate(t.id)}
                className="text-paper-3 hover:text-red-400 transition-colors text-[10px] leading-none"
                title="Delete template"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VibeBar({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-paper-2 w-16 shrink-0">{label}</span>
      <div className="flex-1 bg-sub rounded-full h-1.5">
        <div
          className="bg-paper rounded-full h-1.5 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-paper-3 w-8 text-right">{pct}%</span>
    </div>
  );
}

function AnalysisResults({ song }: { song: Song }) {
  const mins = song.duration_sec ? Math.floor(song.duration_sec / 60) : null;
  const secs = song.duration_sec ? Math.floor(song.duration_sec % 60) : null;

  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Core info */}
      <div className="bg-surface-2 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-paper-2 uppercase tracking-wider mb-4">
          Audio Analysis
        </h2>
        <dl className="flex flex-col gap-3">
          <div className="flex justify-between">
            <dt className="text-sm text-paper-2">Duration</dt>
            <dd className="text-sm font-medium">
              {mins !== null ? `${mins}:${String(secs).padStart(2, "0")}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-paper-2">Tempo</dt>
            <dd className="text-sm font-medium">{song.bpm ? `${Math.round(song.bpm)} BPM` : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-paper-2">Key</dt>
            <dd className="text-sm font-medium">{song.key ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sm text-paper-2">Beat count</dt>
            <dd className="text-sm font-medium">{song.beat_timestamps?.length ?? "—"}</dd>
          </div>
        </dl>
      </div>

      {/* Vibe vector */}
      <div className="bg-surface-2 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-paper-2 uppercase tracking-wider mb-4">
          Vibe Vector
        </h2>
        <div className="flex flex-col gap-3">
          <VibeBar label="Energy" value={song.energy} />
          <VibeBar label="Warmth" value={song.warmth} />
          <VibeBar label="Chaos" value={song.chaos} />
          <VibeBar label="Intimacy" value={song.intimacy} />
        </div>
      </div>

      {/* Sections editor */}
      {song.section_markers && song.section_markers.length > 0 && (
        <div className="bg-surface-2 rounded-xl p-5 md:col-span-2">
          <h2 className="text-sm font-semibold text-paper-2 uppercase tracking-wider mb-4">
            Sections
          </h2>
          <SectionEditor song={song} />
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="mt-6">
      <div className="flex justify-between text-xs text-paper-3 mb-1">
        <span>Analyzing audio…</span>
        <span>{progress}%</span>
      </div>
      <div className="bg-sub rounded-full h-1.5">
        <div
          className="bg-paper rounded-full h-1.5 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export default function SongDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: song, error } = useQuery({
    queryKey: ["song", id],
    queryFn: () => getSong(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const lyricsStatus = query.state.data?.lyrics_status;
      return status === "analyzing" || status === "uploaded" || lyricsStatus === "transcribing"
        ? 3000
        : false;
    },
  });

  const { data: job } = useQuery({
    queryKey: ["job", song?.celery_task_id],
    queryFn: () => getJob(song!.celery_task_id!),
    enabled: !!song?.celery_task_id && (song.status === "analyzing" || song.status === "uploaded"),
    refetchInterval: 3000,
    retry: false,
  });

  if (error) {
    return <p className="text-red-400">Failed to load song.</p>;
  }

  if (!song) {
    return <p className="text-paper-3 text-sm">Loading…</p>;
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{song.title}</h1>
          <p className="text-paper-3 text-sm mt-1">{song.file_name}</p>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded-full font-medium mt-1 ${
            song.status === "analyzed"
              ? "bg-green-900 text-green-300"
              : song.status === "error"
              ? "bg-red-900 text-red-300"
              : "bg-yellow-900 text-yellow-300 animate-pulse"
          }`}
        >
          {song.status}
        </span>
      </div>

      {(song.status === "analyzing" || song.status === "uploaded") && (
        <ProgressBar progress={job?.progress ?? 0} />
      )}

      {song.status === "error" && (
        <div className="mt-4 p-4 bg-red-900/20 rounded-lg text-sm text-red-400">
          <p className="font-medium">Analysis failed</p>
          {song.error_message && <p className="mt-1 text-red-500">{song.error_message}</p>}
        </div>
      )}

      {song.status === "analyzed" && <AnalysisResults song={song} />}
      {song.status === "analyzed" && <DraftSection song={song} />}
    </div>
  );
}

function DistributionStatus({ distributionId }: { distributionId: string }) {
  const { data: dist } = useQuery({
    queryKey: ["distribution", distributionId],
    queryFn: () => getDistribution(distributionId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "pending" || s === "posting" ? 3000 : false;
    },
  });

  if (!dist) return null;

  const statusColor =
    dist.status === "posted"
      ? "bg-green-900 text-green-300"
      : dist.status === "error"
      ? "bg-red-900 text-red-300"
      : "bg-yellow-900 text-yellow-300 animate-pulse";

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
          TikTok · {dist.status}
        </span>
        {dist.platform_post_id && (
          <span className="text-xs text-paper-3 font-mono">{dist.platform_post_id}</span>
        )}
      </div>
      {dist.caption && dist.status === "posted" && (
        <p className="text-xs text-paper-3 line-clamp-2 italic">{dist.caption}</p>
      )}
      {dist.error_message && (
        <p className="text-xs text-red-400">{dist.error_message}</p>
      )}
    </div>
  );
}

function RenderCard({ render }: { render: Render }) {
  const isActive = render.status === "rendering" || render.status === "pending";

  const { data: live } = useQuery({
    queryKey: ["render", render.id],
    queryFn: () => getRender(render.id),
    refetchInterval: isActive ? 4000 : false,
    initialData: render,
  });

  const { data: job } = useQuery({
    queryKey: ["job", live?.celery_task_id],
    queryFn: () => getJob(live!.celery_task_id!),
    enabled: !!live?.celery_task_id && isActive,
    refetchInterval: 4000,
    retry: false,
  });

  const { data: tiktokStatus } = useQuery({
    queryKey: ["tiktok-status"],
    queryFn: getTikTokStatus,
    enabled: live?.status === "done",
  });

  const [distributionId, setDistributionId] = React.useState<string | null>(null);

  const { mutate: distribute, isPending: isDistributing } = useMutation({
    mutationFn: () => distributeRender(render.id),
    onSuccess: (data) => setDistributionId(data.distribution_id),
  });

  const handleDownload = async () => {
    const url = await getRenderDownloadUrl(render.id);
    window.open(url, "_blank");
  };

  const mins = live?.duration_sec ? Math.floor(live.duration_sec / 60) : null;
  const secs = live?.duration_sec ? Math.floor(live.duration_sec % 60) : null;

  return (
    <div className="bg-surface-2 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              live?.status === "done"
                ? "bg-green-900 text-green-300"
                : live?.status === "error"
                ? "bg-red-900 text-red-300"
                : "bg-yellow-900 text-yellow-300 animate-pulse"
            }`}
          >
            {live?.status}
          </span>
          {mins !== null && (
            <span className="text-xs text-paper-3">
              {mins}:{String(secs).padStart(2, "0")}
            </span>
          )}
        </div>
        <span className="text-xs text-paper-3">
          {new Date(render.created_at).toLocaleDateString()}
        </span>
      </div>

      {isActive && (
        <div>
          <div className="flex justify-between text-xs text-paper-3 mb-1">
            <span>Rendering…</span>
            <span>{job?.progress ?? 0}%</span>
          </div>
          <div className="bg-sub rounded-full h-1.5">
            <div
              className="bg-paper rounded-full h-1.5 transition-all duration-500"
              style={{ width: `${job?.progress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {live?.status === "error" && live.error_message && (
        <p className="text-xs text-red-400">{live.error_message}</p>
      )}

      {live?.status === "done" && (
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 text-sm bg-paper text-ink font-medium rounded-lg px-4 py-2 hover:bg-surface transition-colors"
          >
            Download MP4
          </button>
          {tiktokStatus?.connected && !distributionId && (
            <button
              onClick={() => distribute()}
              disabled={isDistributing}
              className="flex-1 text-sm bg-sub text-paper font-medium rounded-lg px-4 py-2 hover:bg-paper-3 transition-colors disabled:opacity-50"
            >
              {isDistributing ? "Posting…" : "Post to TikTok"}
            </button>
          )}
          {!tiktokStatus?.connected && (
            <a
              href="/tiktok"
              className="flex-1 text-center text-sm text-paper-3 font-medium rounded-lg px-4 py-2 border border-sub hover:border-paper-3 transition-colors"
            >
              Connect TikTok
            </a>
          )}
        </div>
      )}

      {distributionId && <DistributionStatus distributionId={distributionId} />}
    </div>
  );
}

// ─── Draft UI ─────────────────────────────────────────────────────────────────

const DRAFT_SECTION_COLORS = [
  "bg-violet-900/70", "bg-blue-900/70", "bg-cyan-900/70", "bg-teal-900/70",
  "bg-emerald-900/70", "bg-amber-900/70", "bg-orange-900/70", "bg-rose-900/70",
];

function DraftTimeline({
  assignments,
  clipDuration,
  clipStart,
  availableVideos,
  onAssignmentsChange,
  song,
  lyricsLines,
  lyricStyle,
  onLyricStyleChange,
}: {
  assignments: DraftAssignment[];
  clipDuration: number;
  clipStart: number;
  availableVideos: Array<{ id: string; title: string; thumbnail_url: string }>;
  onAssignmentsChange: (updated: DraftAssignment[]) => void;
  song: Song;
  lyricsLines: LyricLine[];
  lyricStyle: Required<LyricStyle>;
  onLyricStyleChange: (next: Required<LyricStyle>) => void;
}) {
  const queryClient = useQueryClient();
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const rafRef = React.useRef<number>(0);
  const isDraggingRef = React.useRef(false);
  const videoRefsMap = React.useRef<Record<string, HTMLVideoElement | null>>({});
  const lastSectionVideoIdRef = React.useRef<string | null>(null);

  const [localAssignments, setLocalAssignments] = React.useState(assignments);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(clipStart);
  const [selectedSectionIdx, setSelectedSectionIdx] = React.useState<number | null>(null);
  const [videoReadyIds, setVideoReadyIds] = React.useState<Set<string>>(new Set());
  const [beatInterval, setBeatInterval] = React.useState<1 | 2 | 4>(2);
  React.useEffect(() => {
    setLocalAssignments(assignments);
  }, [assignments]);
  const localRef = React.useRef(localAssignments);
  localRef.current = localAssignments;
  const durRef = React.useRef(clipDuration);
  durRef.current = clipDuration;
  const clipStartRef = React.useRef(clipStart);
  clipStartRef.current = clipStart;
  const isPlayingRef = React.useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Unique video IDs across all sections
  const uniqueVideoIds = React.useMemo(
    () => Array.from(new Set(localAssignments.map((a) => a.video_id))),
    [localAssignments]
  );

  // Auth token — populated client-side after hydration (localStorage unavailable on server)
  const [authToken, setAuthToken] = React.useState("");
  React.useEffect(() => {
    setAuthToken(localStorage.getItem("token") ?? "");
  }, []);

  // Build proxy-stream URLs. Token must come from authToken state (not useMemo closure)
  // so it's always populated after hydration.
  const videoStreamUrls = React.useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const map: Record<string, string | undefined> = {};
    uniqueVideoIds.forEach((id) => {
      map[id] = authToken
        ? `${base}/videos/${id}/proxy-stream?token=${encodeURIComponent(authToken)}`
        : undefined; // don't assign src until we have a token
    });
    return map;
  }, [uniqueVideoIds, authToken]);

  // ── Audio setup ────────────────────────────────────────────────────────────
  const { data: streamUrl } = useQuery({
    queryKey: ["stream-url", song.id],
    queryFn: () => getStreamUrl(song.id),
    staleTime: 50 * 60 * 1000,
  });

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    audio.src = streamUrl;
    // Seek to clip start only after metadata is loaded — setting currentTime
    // immediately after src change silently fails (readyState is HAVE_NOTHING)
    audio.addEventListener("loadedmetadata", () => {
      audio.currentTime = clipStartRef.current;
    }, { once: true });
    const handleError = () => queryClient.invalidateQueries({ queryKey: ["stream-url", song.id] });
    const handleEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      Object.values(videoRefsMap.current).forEach((el) => el?.pause());
    };
    audio.addEventListener("error", handleError);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [streamUrl, song.id, queryClient]);

  React.useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    Object.values(videoRefsMap.current).forEach((el) => el?.pause());
  }, []);

  const startRaf = () => {
    const tick = () => {
      setCurrentTime(audioRef.current?.currentTime ?? 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const relTime = Math.max(0, Math.min(clipDuration, currentTime - clipStart));

  const activeSectionIdx = (() => {
    const idx = localAssignments.findIndex(
      (a) => relTime >= a.section_start && relTime < a.section_end
    );
    if (idx >= 0) return idx;
    return relTime >= clipDuration ? localAssignments.length - 1 : 0;
  })();
  const currentAssignment = localAssignments[activeSectionIdx];
  const activeLyric = React.useMemo(() => {
    if (!lyricsLines.length) return null;
    const t = currentTime;
    return lyricsLines.find((line) => t >= line.start && t < line.end) ?? null;
  }, [lyricsLines, currentTime]);

  // ── Video synchronization ──────────────────────────────────────────────────
  // When section changes: seek new video to safe-start (20%), pause old one
  // When isPlaying changes: play/pause the current section's video
  React.useEffect(() => {
    const videoId = currentAssignment?.video_id ?? null;
    const sectionChanged = videoId !== lastSectionVideoIdRef.current;

    if (sectionChanged) {
      // Pause old video
      const oldId = lastSectionVideoIdRef.current;
      if (oldId) videoRefsMap.current[oldId]?.pause();
      lastSectionVideoIdRef.current = videoId;

      // Seek new video to safe-start and play if audio is playing
      if (videoId) {
        const el = videoRefsMap.current[videoId];
        if (el) {
          const seekAndPlay = () => {
            if (el.duration && isFinite(el.duration)) el.currentTime = el.duration * 0.2;
            if (isPlayingRef.current) el.play().catch(() => {});
          };
          if (el.readyState >= 1) seekAndPlay();
          else el.addEventListener("loadedmetadata", seekAndPlay, { once: true });
        }
      }
    } else if (videoId) {
      // Same section — just sync play/pause state
      const el = videoRefsMap.current[videoId];
      if (el) {
        if (isPlaying) el.play().catch(() => {});
        else el.pause();
      }
    }
  }, [currentAssignment?.video_id, isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Play / pause ───────────────────────────────────────────────────────────
  const doPlay = (audio: HTMLAudioElement) => {
    const cs = clipStartRef.current;
    if (audio.currentTime < cs || audio.currentTime >= cs + durRef.current) {
      audio.currentTime = cs;
    }
    audio.play().then(() => {
      startRaf();
    }).catch((err: DOMException) => {
      console.error("[DraftTimeline] audio.play() failed:", err?.name, err?.message);
      if (err?.name === "AbortError") {
        // Seek still in progress — retry once canplay fires
        audio.addEventListener("canplay", () => {
          audio.play().then(() => startRaf()).catch(() => setIsPlaying(false));
        }, { once: true });
      } else {
        // Unrecoverable (e.g. audio src inaccessible) — revert play state
        setIsPlaying(false);
      }
    });
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    if (audio.paused) {
      setIsPlaying(true); // immediate visual feedback; reverted if play ultimately fails
      doPlay(audio);
    } else {
      audio.pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
      Object.values(videoRefsMap.current).forEach((el) => el?.pause());
    }
  };

  // ── Cut drag handles ───────────────────────────────────────────────────────
  const cuts = localAssignments.slice(0, -1).map((a) => a.section_end);

  const handleCutPointerDown = (e: React.PointerEvent, cutIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startVal = cuts[cutIdx];

    const onMove = (ev: PointerEvent) => {
      if (!timelineRef.current) return;
      const dur = durRef.current;
      const rect = timelineRef.current.getBoundingClientRect();
      const delta = ((ev.clientX - startX) / rect.width) * dur;
      const prevBound = cutIdx > 0 ? localRef.current[cutIdx].section_start + MIN_SEC : MIN_SEC;
      const nextBound = localRef.current[cutIdx + 1]
        ? localRef.current[cutIdx + 1].section_end - MIN_SEC
        : dur - MIN_SEC;
      const newCut = Math.round(Math.max(prevBound, Math.min(nextBound, startVal + delta)) * 10) / 10;
      setLocalAssignments((prev) =>
        prev.map((a, i) => {
          if (i === cutIdx) return { ...a, section_end: newCut };
          if (i === cutIdx + 1) return { ...a, section_start: newCut };
          return a;
        })
      );
    };

    const onUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onAssignmentsChange(localRef.current);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (isDraggingRef.current || !timelineRef.current || !audioRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const relFrac = (e.clientX - rect.left) / rect.width;
    const seekTime = clipStart + relFrac * clipDuration;
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  const swapVideo = (sectionIdx: number, videoId: string) => {
    const vid = availableVideos.find((v) => v.id === videoId);
    if (!vid) return;
    const updated = localAssignments.map((a, i) =>
      i === sectionIdx
        ? { ...a, video_id: vid.id, video_title: vid.title, video_thumbnail: vid.thumbnail_url }
        : a
    );
    setLocalAssignments(updated);
    onAssignmentsChange(updated);
  };

  const splitSectionAt = (idx: number) => {
    const a = localAssignments[idx];
    const mid = Math.round(((a.section_start + a.section_end) / 2) * 10) / 10;
    if (mid - a.section_start < MIN_SEC || a.section_end - mid < MIN_SEC) return;
    const updated = [
      ...localAssignments.slice(0, idx),
      { ...a, section_end: mid },
      { ...a, section_start: mid, ai_reason: "" },
      ...localAssignments.slice(idx + 1),
    ];
    setLocalAssignments(updated);
    onAssignmentsChange(updated);
  };

  const removeSectionAt = (idx: number) => {
    if (localAssignments.length <= 1) return;
    const copy = [...localAssignments];
    if (idx < copy.length - 1) {
      copy[idx + 1] = { ...copy[idx + 1], section_start: copy[idx].section_start };
    } else {
      copy[idx - 1] = { ...copy[idx - 1], section_end: copy[idx].section_end };
    }
    const updated = copy.filter((_, i) => i !== idx);
    setLocalAssignments(updated);
    setSelectedSectionIdx(null);
    onAssignmentsChange(updated);
  };

  // ── Beat-sync section generation ──────────────────────────────────────────
  // Slice the song's beat_timestamps to the clip window, group every N beats
  // into a section, cycle through availableVideos, replace localAssignments.
  const generateBeatSections = (interval: 1 | 2 | 4) => {
    const allBeats = song.beat_timestamps ?? [];
    if (allBeats.length === 0 || availableVideos.length === 0) return;

    // Keep only beats within the clip region, convert to clip-relative time
    const beats = allBeats
      .filter((b) => b >= clipStart && b <= clipStart + clipDuration)
      .map((b) => Math.round((b - clipStart) * 1000) / 1000);

    if (beats.length < interval) return;

    // Shuffle videos so adjacent sections get varied clips
    const shuffled = [...availableVideos].sort(() => Math.random() - 0.5);

    const sections: DraftAssignment[] = [];
    let videoIdx = 0;
    for (let i = 0; i + interval <= beats.length; i += interval) {
      const start = beats[i];
      const end = i + interval < beats.length ? beats[i + interval] : clipDuration;
      if (end - start < 0.05) continue;
      const v = shuffled[videoIdx % shuffled.length];
      sections.push({
        section_index: sections.length,
        section_label: `beat-${sections.length + 1}`,
        section_start: start,
        section_end: end,
        video_id: v.id,
        video_title: v.title,
        video_thumbnail: v.thumbnail_url,
        ai_reason: null,
      });
      videoIdx++;
    }

    if (sections.length === 0) return;
    // Always absorb leftover head/tail space into the first/last section.
    // This keeps beat grouping behavior intact while ensuring full clip coverage.
    sections[0].section_start = 0;
    sections[sections.length - 1].section_end = clipDuration;
    setLocalAssignments(sections);
    setSelectedSectionIdx(null);
    onAssignmentsChange(sections);
  };

  const videosLoading = false; // proxy URLs are immediate — no async fetch needed

  return (
    <div className="space-y-4">
      <audio ref={audioRef} preload="metadata" />

      <div className="flex gap-4 items-start">
        {/* ── 9:16 Video Preview ───────────────────────────────────────────── */}
        <div
          className="relative rounded-xl overflow-hidden bg-surface-2 shrink-0 border border-sub"
          style={{ width: 140, aspectRatio: "9 / 16" }}
        >
          {/* One <video> per unique video — only active one is visible */}
          {uniqueVideoIds.map((videoId) => {
            const src = videoStreamUrls[videoId];
            return (
              <video
                key={videoId}
                ref={(el) => { videoRefsMap.current[videoId] = el; }}
                src={src}
                muted
                playsInline
                preload="metadata"
                loop
                onLoadedData={() => {
                  setVideoReadyIds((prev) => {
                    const next = new Set(prev);
                    next.add(videoId);
                    return next;
                  });
                  // If audio is already playing when this video loads, start it
                  if (isPlayingRef.current) {
                    videoRefsMap.current[videoId]?.play().catch(() => {});
                  }
                }}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  videoId === currentAssignment?.video_id && videoReadyIds.has(videoId) ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              />
            );
          })}

          {/* Fallback thumbnail shown while proxy video loads */}
          {!videoReadyIds.has(currentAssignment?.video_id ?? "") && currentAssignment?.video_thumbnail && (
            <img
              src={currentAssignment.video_thumbnail}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          <div className="absolute inset-0 bg-black/10 pointer-events-none" />

          {/* Lyrics overlay */}
          {activeLyric && (
            <div
              className="absolute left-2 right-2 pointer-events-none"
              style={{ bottom: lyricStyle.bottom_offset }}
            >
              <p
                className={`text-white font-medium drop-shadow-sm ${
                  lyricStyle.align === "left"
                    ? "text-left"
                    : lyricStyle.align === "right"
                    ? "text-right"
                    : "text-center"
                }`}
                style={{ fontSize: lyricStyle.font_size, lineHeight: `${Math.round(lyricStyle.font_size * 1.35)}px` }}
              >
                {activeLyric.text}
              </p>
            </div>
          )}

          {/* Play/pause button */}
          <button
            onClick={togglePlay}
            disabled={!streamUrl}
            className="absolute inset-0 flex items-center justify-center group"
          >
            <div
              className={`w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white text-xl transition-all group-hover:bg-black/70 group-hover:scale-105 group-disabled:opacity-40 ${
                isPlaying ? "opacity-70" : "opacity-100"
              }`}
            >
              {isPlaying ? "⏸" : "▶"}
            </div>
          </button>

          {/* Loading spinner while yt-dlp extracts URLs */}
          {videosLoading && (
            <div className="absolute top-2 right-2 w-4 h-4 rounded-full border-2 border-white/30 border-t-white/80 animate-spin pointer-events-none" />
          )}

          {/* Section label overlay */}
          <div className="absolute bottom-0 left-0 right-0 px-2 py-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <p className="text-[11px] text-white font-medium capitalize truncate">
              {currentAssignment?.section_label}
            </p>
            <p className="text-[9px] text-white/50 truncate">{currentAssignment?.video_title}</p>
          </div>

          {/* Draft badge */}
          <div className="absolute top-0 left-0 right-0 px-2 pt-2 pointer-events-none">
            <span className="text-[9px] text-amber-300/80 font-semibold tracking-widest uppercase">
              Draft
            </span>
          </div>
        </div>

        {/* ── Right: filmstrip + section list ─────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Filmstrip */}
          <div
            ref={timelineRef}
            onClick={handleTimelineClick}
            className="relative h-16 bg-sub rounded-lg overflow-hidden select-none cursor-pointer"
          >
            {localAssignments.map((a, i) => {
              const leftPct = (a.section_start / clipDuration) * 100;
              const widthPct = ((a.section_end - a.section_start) / clipDuration) * 100;
              const isSelected = i === selectedSectionIdx;
              return (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 border-r border-white/10 bg-paper-3/70 transition-[filter] cursor-pointer ${
                    i === activeSectionIdx && isPlaying ? "brightness-125" : ""
                  } ${isSelected ? "ring-2 ring-inset ring-white" : ""}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSectionIdx(isSelected ? null : i);
                  }}
                >
                  {a.video_thumbnail && (
                    <img
                      src={a.video_thumbnail}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover opacity-40 pointer-events-none"
                    />
                  )}
                  <div className="absolute inset-0 flex flex-col justify-center px-1.5 overflow-hidden pointer-events-none">
                    <span className="text-[10px] text-paper/90 font-medium tabular-nums leading-tight">
                      {(a.section_end - a.section_start).toFixed(1)}s
                    </span>
                    <span className="text-[9px] text-paper/60 capitalize truncate leading-tight">
                      {a.section_label}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Cut handles */}
            {cuts.map((cut, i) => (
              <div
                key={i}
                onPointerDown={(e) => handleCutPointerDown(e, i)}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize z-10 flex items-center justify-center group"
                style={{ left: `${(cut / clipDuration) * 100}%` }}
              >
                <div className="absolute inset-y-0 w-0.5 bg-paper/50 group-hover:bg-paper transition-colors" />
              </div>
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-paper/90 z-20 pointer-events-none"
              style={{ left: `${(relTime / clipDuration) * 100}%` }}
            />
          </div>

          {/* Time readout + beat-sync controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-paper-3 tabular-nums">
              {formatTime(relTime)} / {formatTime(clipDuration)}
            </span>

            {/* Beat-sync generator */}
            {(song.beat_timestamps?.length ?? 0) > 0 && availableVideos.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-paper-3 uppercase tracking-wider">Beat cut:</span>
                {([1, 2, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => { setBeatInterval(n); generateBeatSections(n); }}
                    className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                      beatInterval === n
                        ? "bg-indigo-600 text-white"
                        : "bg-sub text-paper-2 hover:bg-surface-2"
                    }`}
                  >
                    {n === 1 ? "every beat" : n === 2 ? "every 2" : "every 4"}
                  </button>
                ))}
              </div>
            )}

            {/* Lyrics styling controls */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-paper-3 uppercase tracking-wider">Lyrics</span>
              <label className="text-[10px] text-paper-3 flex items-center gap-1">
                Size
                <input
                  type="range"
                  min={6}
                  max={24}
                  value={lyricStyle.font_size}
                  onChange={(e) => onLyricStyleChange({ ...lyricStyle, font_size: parseInt(e.target.value) })}
                  className="w-20 accent-zinc-300"
                />
              </label>
              <label className="text-[10px] text-paper-3 flex items-center gap-1">
                Y
                <input
                  type="range"
                  min={12}
                  max={260}
                  value={lyricStyle.bottom_offset}
                  onChange={(e) => onLyricStyleChange({ ...lyricStyle, bottom_offset: parseInt(e.target.value) })}
                  className="w-20 accent-zinc-300"
                />
              </label>
              <select
                value={lyricStyle.align}
                onChange={(e) => onLyricStyleChange({ ...lyricStyle, align: e.target.value as "left" | "center" | "right" })}
                className="bg-paper-3 text-paper text-[10px] rounded px-1.5 py-0.5"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          {/* Clip picker — shown when a section block is selected */}
          {selectedSectionIdx !== null && availableVideos.length > 0 && (
            <div className="rounded-lg bg-sub/80 p-2">
              <p className="text-[9px] text-paper-3 uppercase tracking-wider mb-1.5">
                Swap clip — {localAssignments[selectedSectionIdx]?.section_label}
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {availableVideos.map((v) => {
                  const isCurrent = v.id === localAssignments[selectedSectionIdx]?.video_id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => { swapVideo(selectedSectionIdx, v.id); setSelectedSectionIdx(null); }}
                      className={`shrink-0 rounded overflow-hidden border-2 transition-colors ${
                        isCurrent ? "border-indigo-400" : "border-transparent hover:border-paper-2"
                      }`}
                    >
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt={v.title} className="w-16 h-10 object-cover" />
                      ) : (
                        <div className="w-16 h-10 bg-paper-3" />
                      )}
                      <p className="text-[8px] text-paper-2 truncate px-0.5 py-0.5 max-w-[64px]">
                        {v.title.slice(0, 18)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function InlineRenderPanel({ renderId }: { renderId: string }) {
  const isActive = (s: string) => s === "rendering" || s === "pending";

  const { data: render } = useQuery({
    queryKey: ["render", renderId],
    queryFn: () => getRender(renderId),
    refetchInterval: (q) => isActive(q.state.data?.status ?? "pending") ? 4000 : false,
  });

  const { data: job } = useQuery({
    queryKey: ["job", render?.celery_task_id],
    queryFn: () => getJob(render!.celery_task_id!),
    enabled: !!render?.celery_task_id && isActive(render?.status ?? ""),
    refetchInterval: 4000,
    retry: false,
  });

  const { data: tiktokStatus } = useQuery({
    queryKey: ["tiktok-status"],
    queryFn: getTikTokStatus,
    enabled: render?.status === "done",
  });

  const [distributionId, setDistributionId] = React.useState<string | null>(null);

  const { mutate: distribute, isPending: isDistributing } = useMutation({
    mutationFn: () => distributeRender(renderId),
    onSuccess: (data) => setDistributionId(data.distribution_id),
  });

  const handleDownload = async () => {
    const url = await getRenderDownloadUrl(renderId);
    window.open(url, "_blank");
  };

  if (!render) {
    return <p className="text-xs text-paper-3 animate-pulse py-2">Starting render…</p>;
  }

  const pct = job?.progress ?? 0;
  const mins = render.duration_sec ? Math.floor(render.duration_sec / 60) : null;
  const secs = render.duration_sec ? Math.floor(render.duration_sec % 60) : null;

  if (isActive(render.status)) {
    return (
      <div className="py-2 space-y-1.5">
        <div className="flex justify-between text-xs text-paper-3">
          <span>Rendering…</span>
          <span>{pct}%</span>
        </div>
        <div className="bg-sub rounded-full h-1.5">
          <div className="bg-paper rounded-full h-1.5 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (render.status === "error") {
    return <p className="text-xs text-red-400 py-2">{render.error_message ?? "Render failed"}</p>;
  }

  if (render.status === "done") {
    return (
      <div className="py-2 space-y-2">
        <p className="text-xs text-green-400 flex items-center gap-1.5">
          ✓ Done {mins !== null && <span className="text-paper-3">{mins}:{String(secs).padStart(2, "0")}</span>}
        </p>
        <button
          onClick={handleDownload}
          className="w-full text-xs bg-paper text-ink font-medium rounded-lg px-3 py-2 hover:bg-surface transition-colors"
        >
          Download MP4
        </button>
        {tiktokStatus?.connected && !distributionId && (
          <button
            onClick={() => distribute()}
            disabled={isDistributing}
            className="w-full text-xs bg-sub text-paper font-medium rounded-lg px-3 py-2 hover:bg-paper-3 transition-colors disabled:opacity-50"
          >
            {isDistributing ? "Posting…" : "Post to TikTok"}
          </button>
        )}
        {!tiktokStatus?.connected && (
          <a href="/tiktok" className="block text-center text-xs text-paper-3 rounded-lg px-3 py-2 border border-sub hover:border-paper-3 transition-colors">
            Connect TikTok
          </a>
        )}
        {distributionId && <DistributionStatus distributionId={distributionId} />}
      </div>
    );
  }

  return null;
}

function DraftCard({
  draft,
  song,
  onRenderStarted,
  onDeleted,
  onTemplateSaved,
}: {
  draft: Draft;
  song: Song;
  onRenderStarted: (renderId: string, jobId: string) => void;
  onDeleted: () => void;
  onTemplateSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const clipDuration =
    (draft.clip_end ?? song.duration_sec ?? 0) - (draft.clip_start ?? 0);
  const [localAssignments, setLocalAssignments] = React.useState<DraftAssignment[]>(draft.assignments);
  const [isDirty, setIsDirty] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [localRenderId, setLocalRenderId] = React.useState<string | null>(null);
  const [lyricStyle, setLyricStyle] = React.useState<Required<LyricStyle>>({
    font_size: 11,
    bottom_offset: 48,
    align: "center",
  });

  React.useEffect(() => {
    setLocalAssignments(draft.assignments);
    const style = draft.lyric_style ?? {};
    setLyricStyle({
      font_size: style.font_size ?? 11,
      bottom_offset: style.bottom_offset ?? 48,
      align: (style.align as "left" | "center" | "right") ?? "center",
    });
    setIsDirty(false);
  }, [draft.id, draft.assignments, draft.lyric_style]);

  const { data: aesthetic } = useQuery({
    queryKey: ["aesthetic", draft.aesthetic_id],
    queryFn: () => getAesthetic(draft.aesthetic_id),
  });

  const availableVideos = (aesthetic?.videos ?? [])
    .filter((v) => v.status === "analyzed")
    .map((v) => ({ id: v.id, title: v.title, thumbnail_url: v.thumbnail_url }));

  const { mutate: saveAssignments, isPending: isSaving } = useMutation({
    mutationFn: (payload: { assignments?: DraftAssignment[]; lyric_style?: LyricStyle }) =>
      updateDraft(draft.id, payload),
    onSuccess: () => {
      setIsDirty(false);
    },
  });

  const { mutate: removeDraft } = useMutation({
    mutationFn: () => deleteDraft(draft.id),
    onSuccess: onDeleted,
  });

  const { mutate: saveAsTemplate, isPending: isSavingTemplate } = useMutation({
    mutationFn: (name: string) => saveDraftAsTemplate(draft.id, name),
    onSuccess: () => {
      onTemplateSaved();
    },
  });

  const { mutate: startRender, isPending: isRendering } = useMutation({
    mutationFn: () => renderFromDraft(draft.id, {
      lyric_style: lyricStyle,
      ...(song.lyrics_lines && song.lyrics_lines.length > 0
        ? { lyrics_lines: song.lyrics_lines }
        : {}),
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["renders", song.id] });
      onRenderStarted(data.render_id, data.job_id);
      setLocalRenderId(data.render_id);
      setExpanded(true);
    },
  });

  return (
    <div className="bg-surface-2 rounded-xl border border-sub overflow-hidden flex flex-col">
      {/* Header row — always visible */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-paper-2 hover:text-paper transition-colors text-xs w-4 shrink-0"
        >
          {expanded ? "▾" : "▸"}
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-xs font-medium text-paper hover:text-paper transition-colors truncate min-w-0"
        >
          {aesthetic?.name ?? "Draft"}
          {draft.clip_start != null && draft.clip_end != null && (
            <span className="ml-1.5 text-paper-3 font-normal text-[10px]">
              {formatTime(draft.clip_start)}–{formatTime(draft.clip_end)}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {localRenderId ? (
            <button
              onClick={() => { setLocalRenderId(null); setExpanded(false); }}
              className="text-[10px] text-paper-3 hover:text-paper transition-colors"
            >
              ← Edit
            </button>
          ) : (
            <>
              {isSaving && <span className="text-[10px] text-paper-3">Saving…</span>}
              {isDirty && !isSaving && <span className="text-[10px] text-amber-400">Unsaved</span>}
              <button
                onClick={() => saveAssignments({ assignments: localAssignments, lyric_style: lyricStyle })}
                disabled={!isDirty || isSaving}
                className="text-[10px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3 disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => {
                  const name = window.prompt("Template name", `Template ${new Date().toLocaleDateString()}`)?.trim();
                  if (name) saveAsTemplate(name);
                }}
                disabled={isSavingTemplate}
                className="text-[10px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3 disabled:opacity-40"
              >
                {isSavingTemplate ? "…" : "Template"}
              </button>
              <button
                onClick={() => startRender()}
                disabled={isRendering}
                className="text-[10px] px-2.5 py-1 rounded bg-paper text-ink font-medium hover:bg-surface transition-colors disabled:opacity-50"
              >
                {isRendering ? "…" : "Render"}
              </button>
            </>
          )}
          <button
            onClick={() => removeDraft()}
            className="text-sm text-red-400 hover:text-red-300 transition-colors ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expandable area */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-sub pt-3">
          {localRenderId ? (
            <InlineRenderPanel renderId={localRenderId} />
          ) : (
            <div className="space-y-3">
              {draft.ai_notes && (
                <p className="text-[10px] text-paper-3 italic">{draft.ai_notes}</p>
              )}
              {clipDuration > 0 && draft.assignments.length > 0 && (
                <DraftTimeline
                  assignments={localAssignments}
                  clipDuration={clipDuration}
                  clipStart={draft.clip_start ?? 0}
                  availableVideos={availableVideos}
                  onAssignmentsChange={(updated) => {
                    setLocalAssignments(updated);
                    setIsDirty(true);
                  }}
                  song={song}
                  lyricsLines={song.lyrics_lines ?? []}
                  lyricStyle={lyricStyle}
                  onLyricStyleChange={(next) => {
                    setLyricStyle(next);
                    setIsDirty(true);
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LyricsGroupEditor({ song }: { song: Song }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = React.useState<LyricLine[]>(song.lyrics_lines ?? []);
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ index: number; startX: number; startCut: number } | null>(null);
  const [timelineZoom, setTimelineZoom] = React.useState(2.5);
  const [editingLineIdx, setEditingLineIdx] = React.useState<number | null>(null);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const rafRef = React.useRef<number>(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);

  React.useEffect(() => {
    setLines(song.lyrics_lines ?? []);
  }, [song.id, song.lyrics_lines]);

  const linesRef = React.useRef(lines);
  linesRef.current = lines;

  const { data: streamUrl } = useQuery({
    queryKey: ["lyrics-editor-stream-url", song.id],
    queryFn: () => getStreamUrl(song.id),
    staleTime: 50 * 60 * 1000,
  });

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    audio.src = streamUrl;
    const onError = () => queryClient.invalidateQueries({ queryKey: ["lyrics-editor-stream-url", song.id] });
    const onEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    };
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
    };
  }, [queryClient, song.id, streamUrl]);

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const { mutate: saveLines, isPending: isSaving, isSuccess, error } = useMutation({
    mutationFn: () => updateLyricsLines(song.id, lines),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["song", song.id] });
    },
  });

  const duration = song.duration_sec ?? 0;
  const durationSafe = duration > 0 ? duration : Math.max(...lines.map((l) => l.end), 1);
  const MIN_LYRIC_SEC = 0.1;

  const startRaf = () => {
    const tick = () => {
      setCurrentTime(audioRef.current?.currentTime ?? 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    if (audio.paused) {
      if (audio.currentTime >= durationSafe) audio.currentTime = 0;
      audio.play().then(() => {
        setIsPlaying(true);
        startRaf();
      }).catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  };

  const updateLine = (idx: number, patch: Partial<LyricLine>) => {
    setLines((prev) => prev.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  };

  const splitLine = (idx: number) => {
    const target = lines[idx];
    if (!target) return;
    const words = target.text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return;
    const midWord = Math.max(1, Math.floor(words.length / 2));
    const midTime = Number(((target.start + target.end) / 2).toFixed(3));
    if (midTime <= target.start || midTime >= target.end) return;
    const first: LyricLine = { start: target.start, end: midTime, text: words.slice(0, midWord).join(" ") };
    const second: LyricLine = { start: midTime, end: target.end, text: words.slice(midWord).join(" ") };
    setLines((prev) => [...prev.slice(0, idx), first, second, ...prev.slice(idx + 1)]);
  };

  const mergeWithNext = (idx: number) => {
    if (idx >= lines.length - 1) return;
    const a = lines[idx];
    const b = lines[idx + 1];
    const merged: LyricLine = {
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end),
      text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
    };
    setLines((prev) => [...prev.slice(0, idx), merged, ...prev.slice(idx + 2)]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const addLine = () => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      const start = last ? Number(last.end.toFixed(3)) : 0;
      const end = duration > 0 ? Math.min(duration, start + 2) : start + 2;
      return [...prev, { start, end, text: "new lyric group" }];
    });
  };

  const normalize = () => {
    setLines((prev) => {
      const sorted = [...prev]
        .map((line) => ({
          start: Number(Math.max(0, line.start).toFixed(3)),
          end: Number(Math.max(0, line.end).toFixed(3)),
          text: line.text.trim(),
        }))
        .filter((line) => line.text && line.end > line.start)
        .sort((a, b) => a.start - b.start);

      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
          sorted[i].start = Number(sorted[i - 1].end.toFixed(3));
          if (sorted[i].end <= sorted[i].start) {
            sorted[i].end = Number((sorted[i].start + 0.1).toFixed(3));
          }
        }
      }
      return sorted;
    });
  };

  const handleBoundaryPointerDown = (e: React.PointerEvent, idx: number) => {
    if (idx >= linesRef.current.length - 1 || !timelineRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      index: idx,
      startX: e.clientX,
      startCut: linesRef.current[idx].end,
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaSec = ((ev.clientX - dragRef.current.startX) / rect.width) * durationSafe;
      const raw = dragRef.current.startCut + deltaSec;
      const current = linesRef.current[dragRef.current.index];
      const next = linesRef.current[dragRef.current.index + 1];
      if (!current || !next) return;
      const minCut = current.start + MIN_LYRIC_SEC;
      const maxCut = next.end - MIN_LYRIC_SEC;
      const cut = Math.max(minCut, Math.min(maxCut, raw));
      const rounded = Number(cut.toFixed(3));
      setLines((prev) =>
        prev.map((line, i) => {
          if (i === dragRef.current!.index) return { ...line, end: rounded };
          if (i === dragRef.current!.index + 1) return { ...line, start: rounded };
          return line;
        })
      );
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || !audioRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const frac = rect.width > 0 ? x / rect.width : 0;
    const t = frac * durationSafe;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  return (
    <div className="mb-4 rounded-xl border border-sub bg-surface-2/70 p-3 space-y-2">
      <audio ref={audioRef} preload="metadata" />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-paper-2">Lyric Groups</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlayback}
            disabled={!streamUrl}
            className="text-[11px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3 disabled:opacity-50"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <span className="text-[10px] text-paper-3 tabular-nums w-20 text-center">
            {formatTime(currentTime)} / {formatTime(durationSafe)}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTimelineZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
              className="text-[11px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3"
            >
              -
            </button>
            <span className="text-[10px] text-paper-3 w-12 text-center">{timelineZoom.toFixed(1)}x</span>
            <button
              onClick={() => setTimelineZoom((z) => Math.min(8, Number((z + 0.5).toFixed(1))))}
              className="text-[11px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3"
            >
              +
            </button>
          </div>
          <button
            onClick={normalize}
            className="text-[11px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3"
          >
            Normalize
          </button>
          <button
            onClick={() => addLine()}
            className="text-[11px] px-2 py-1 rounded bg-sub text-paper hover:bg-paper-3"
          >
            Add Group
          </button>
          <button
            onClick={() => saveLines()}
            disabled={isSaving}
            className="text-[11px] px-2 py-1 rounded bg-paper text-ink hover:bg-surface disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save Groups"}
          </button>
        </div>
      </div>

      {error && <p className="text-[11px] text-red-400">{(error as Error).message}</p>}
      {isSuccess && <p className="text-[11px] text-green-400">Saved</p>}

      {lines.length === 0 ? (
        <p className="text-xs text-paper-3">No lyric groups yet. Transcribe first, then edit here.</p>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto pb-1">
            <div
              ref={timelineRef}
              onClick={handleTimelineClick}
              className="relative h-16 rounded-lg bg-sub overflow-hidden border border-sub"
              style={{ width: `${Math.max(100, timelineZoom * 100)}%` }}
            >
              {lines.map((line, idx) => {
                const left = (line.start / durationSafe) * 100;
                const width = ((line.end - line.start) / durationSafe) * 100;
                return (
                  <div
                    key={`line-block-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingLineIdx(idx);
                    }}
                    className={`absolute top-0 bottom-0 px-1.5 border-r border-zinc-900/70 ${
                      idx % 2 === 0 ? "bg-indigo-900/60" : "bg-cyan-900/60"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {editingLineIdx === idx ? (
                      <input
                        autoFocus
                        value={line.text}
                        onChange={(e) => updateLine(idx, { text: e.target.value })}
                        onBlur={() => setEditingLineIdx(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === "Escape") {
                            setEditingLineIdx(null);
                          }
                        }}
                        className="mt-1 w-full bg-transparent text-[10px] text-paper border-b border-paper/50 outline-none"
                      />
                    ) : (
                      <p className="text-[10px] text-paper truncate mt-1">{line.text}</p>
                    )}
                  </div>
                );
              })}
              {lines.slice(0, -1).map((line, idx) => (
                <div
                  key={`line-handle-${idx}`}
                  onPointerDown={(e) => handleBoundaryPointerDown(e, idx)}
                  className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize z-10 flex items-center justify-center group"
                  style={{ left: `${(line.end / durationSafe) * 100}%` }}
                >
                  <div className="absolute inset-y-0 w-0.5 bg-paper/60 group-hover:bg-paper" />
                </div>
              ))}
              <div
                className="absolute top-0 bottom-0 w-px bg-paper/90 z-20 pointer-events-none"
                style={{ left: `${Math.max(0, Math.min(100, (currentTime / durationSafe) * 100))}%` }}
              />
            </div>
          </div>
          <p className="text-[10px] text-paper-3">
            Drag handles to change lyric-group switch points. Click timeline to seek, then play/pause to align with audio.
          </p>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {lines.map((line, idx) => (
            <div key={idx} className="rounded-lg bg-sub/70 p-2 space-y-2">
              <div className="grid grid-cols-[72px_72px_1fr_auto] gap-2 items-center">
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  value={line.start}
                  onChange={(e) => updateLine(idx, { start: parseFloat(e.target.value || "0") })}
                  className="bg-surface-2 rounded px-2 py-1 text-xs text-paper"
                />
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  value={line.end}
                  onChange={(e) => updateLine(idx, { end: parseFloat(e.target.value || "0") })}
                  className="bg-surface-2 rounded px-2 py-1 text-xs text-paper"
                />
                <input
                  type="text"
                  value={line.text}
                  onChange={(e) => updateLine(idx, { text: e.target.value })}
                  className="bg-surface-2 rounded px-2 py-1 text-xs text-paper"
                />
                <button
                  onClick={() => removeLine(idx)}
                  className="text-[11px] px-2 py-1 rounded bg-surface-2 text-paper-2 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => splitLine(idx)}
                  className="text-[10px] px-2 py-0.5 rounded bg-surface-2 text-paper-2 hover:text-paper"
                >
                  Split Words
                </button>
                <button
                  onClick={() => mergeWithNext(idx)}
                  disabled={idx >= lines.length - 1}
                  className="text-[10px] px-2 py-0.5 rounded bg-surface-2 text-paper-2 hover:text-paper disabled:opacity-40"
                >
                  Merge Next
                </button>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DraftSection({ song }: { song: Song }) {
  const queryClient = useQueryClient();
  const [selectedAesthetic, setSelectedAesthetic] = React.useState("");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState("");
  const [selectedSectionIdx, setSelectedSectionIdx] = React.useState<string>("all");
  const [renderStarted, setRenderStarted] = React.useState<string | null>(null);
  const [showLyricsEditor, setShowLyricsEditor] = React.useState(false);
  const [draftCount, setDraftCount] = React.useState(1);
  const [createdCount, setCreatedCount] = React.useState(0);

  const { data: aesthetics = [] } = useQuery({
    queryKey: ["aesthetics"],
    queryFn: getAesthetics,
  });

  const { data: drafts = [], refetch: refetchDrafts } = useQuery({
    queryKey: ["drafts", song.id],
    queryFn: () => getDrafts(song.id),
  });
  const { data: draftTemplates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ["draft-templates"],
    queryFn: getDraftTemplates,
  });

  const sections = song.section_markers ?? [];

  const [isCreating, setIsCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<Error | null>(null);

  const handleCreateDrafts = async () => {
    if (!selectedAesthetic) return;
    setIsCreating(true);
    setCreateError(null);
    setCreatedCount(0);
    try {
      const sec = selectedSectionIdx !== "all" ? sections[parseInt(selectedSectionIdx)] : null;
      for (let i = 0; i < draftCount; i++) {
        await createDraft(song.id, selectedAesthetic, sec?.start, sec?.end);
        setCreatedCount(i + 1);
        await refetchDrafts();
      }
      setSelectedAesthetic("");
      setSelectedSectionIdx("all");
    } catch (err: any) {
      setCreateError(err);
    } finally {
      setIsCreating(false);
      setCreatedCount(0);
    }
  };
  const { mutate: makeDraftFromTemplate, isPending: isCreatingFromTemplate, error: templateError } = useMutation({
    mutationFn: () => {
      const sec = selectedSectionIdx !== "all" ? sections[parseInt(selectedSectionIdx)] : null;
      return createDraftFromTemplate(song.id, selectedTemplateId, sec?.start, sec?.end);
    },
    onSuccess: () => {
      refetchDrafts();
      setSelectedTemplateId("");
    },
  });
  const { mutate: removeTemplate, isPending: isDeletingTemplate } = useMutation({
    mutationFn: (id: string) => deleteDraftTemplate(id),
    onSuccess: () => {
      refetchTemplates();
      if (selectedTemplateId) setSelectedTemplateId("");
    },
  });
  const { mutate: transcribeLyrics, isPending: isTranscribing } = useMutation({
    mutationFn: () => transcribeSongLyrics(song.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["song", song.id] });
    },
  });

  const readyAesthetics = aesthetics.filter((a) => a.video_count > 0);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-paper-2 uppercase tracking-wider">
          Draft
        </h2>
        <div className="flex items-center gap-2">
          {song.lyrics_lines && song.lyrics_lines.length > 0 && (
            <button
              onClick={() => setShowLyricsEditor((v) => !v)}
              className="text-xs px-2.5 py-1 rounded border border-sub text-paper hover:border-paper-2 hover:text-paper transition-colors"
            >
              {showLyricsEditor ? "Hide Lyrics Editor" : "Edit Lyrics Groups"}
            </button>
          )}
          <button
            onClick={() => transcribeLyrics()}
            disabled={isTranscribing || song.lyrics_status === "transcribing"}
            className="text-xs px-2.5 py-1 rounded border border-sub text-paper hover:border-paper-2 hover:text-paper transition-colors disabled:opacity-50"
          >
            {song.lyrics_status === "transcribing" || isTranscribing
              ? "Transcribing lyrics…"
              : song.lyrics_status === "complete"
              ? "Re-transcribe Lyrics"
              : "Transcribe Lyrics"}
          </button>
          {song.lyrics_status === "complete" && (
            <span className="text-[10px] text-green-400">Lyrics ready</span>
          )}
          {song.lyrics_status === "error" && (
            <span className="text-[10px] text-red-400">Transcription failed</span>
          )}
        </div>
      </div>

      {/* Create draft controls */}
      {aesthetics.length === 0 ? (
        <p className="text-paper-3 text-sm mb-4">
          <a href="/aesthetics" className="text-paper-2 hover:text-paper">Create an aesthetic</a> first, then scrape some videos and come back to draft an edit.
        </p>
      ) : readyAesthetics.length === 0 ? (
        <p className="text-paper-3 text-sm mb-4">
          <a href="/videos" className="text-paper-2 hover:text-paper">Scrape some videos</a> first, then come back to draft an edit.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex items-center gap-2">
            {/* Section picker */}
            <select
              value={selectedSectionIdx}
              onChange={(e) => setSelectedSectionIdx(e.target.value)}
              className="bg-sub rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-paper/20 flex-1 max-w-[180px]"
            >
              <option value="all">Entire song</option>
              {sections.map((sec, i) => (
                <option key={i} value={String(i)}>
                  {sec.label} ({formatTime(sec.start)}–{formatTime(sec.end)})
                </option>
              ))}
            </select>

            {/* Aesthetic picker */}
            <select
              value={selectedAesthetic}
              onChange={(e) => setSelectedAesthetic(e.target.value)}
              className="bg-sub rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-paper/20 flex-1 max-w-xs"
            >
              <option value="">Choose aesthetic…</option>
              {readyAesthetics.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.video_count} videos)
                </option>
              ))}
            </select>

            {/* Draft count dial */}
            <div className="flex items-center border border-sub rounded-lg overflow-hidden shrink-0">
              <button
                onClick={() => setDraftCount((n) => Math.max(1, n - 1))}
                disabled={isCreating}
                className="px-2 py-1.5 text-paper-2 hover:text-paper hover:bg-paper-3 transition-colors text-sm disabled:opacity-40"
              >
                −
              </button>
              <span className="px-2 text-sm text-paper tabular-nums w-6 text-center">{draftCount}</span>
              <button
                onClick={() => setDraftCount((n) => Math.min(10, n + 1))}
                disabled={isCreating}
                className="px-2 py-1.5 text-paper-2 hover:text-paper hover:bg-paper-3 transition-colors text-sm disabled:opacity-40"
              >
                +
              </button>
            </div>

            <button
              onClick={handleCreateDrafts}
              disabled={!selectedAesthetic || isCreating}
              className="text-sm bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg px-4 py-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isCreating
                ? `Generating ${createdCount}/${draftCount}…`
                : `Create Draft${draftCount > 1 ? `s (${draftCount})` : ""}`}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="bg-sub rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-paper/20 flex-1 max-w-xs"
            >
              <option value="">Choose template…</option>
              {draftTemplates.map((t: DraftTemplate) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => makeDraftFromTemplate()}
              disabled={!selectedTemplateId || isCreatingFromTemplate}
              className="text-sm bg-paper-3 hover:bg-paper-2 text-paper font-medium rounded-lg px-4 py-1.5 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isCreatingFromTemplate ? "Generating…" : "Create from Template"}
            </button>
            <button
              onClick={() => selectedTemplateId && removeTemplate(selectedTemplateId)}
              disabled={!selectedTemplateId || isDeletingTemplate}
              className="text-xs px-2.5 py-1.5 rounded border border-sub text-paper-2 hover:text-red-400 hover:border-red-500/50 transition-colors disabled:opacity-50"
            >
              Delete Template
            </button>
          </div>
        </div>
      )}

      {createError && (
        <p className="text-xs text-red-400 mb-3">{createError.message}</p>
      )}
      {templateError && (
        <p className="text-xs text-red-400 mb-3">{(templateError as Error).message}</p>
      )}
      {song.lyrics_status === "error" && song.lyrics_error_message && (
        <p className="text-xs text-red-400 mb-3">{song.lyrics_error_message}</p>
      )}
      {showLyricsEditor && <LyricsGroupEditor song={song} />}

      {/* Draft cards */}
      <div className="flex flex-col gap-4">
        {drafts.map((d) => (
          <div key={d.id}>
            <DraftCard
              draft={d}
              song={song}
              onRenderStarted={(renderId, jobId) => {
                setRenderStarted(renderId);
              }}
              onDeleted={() => refetchDrafts()}
              onTemplateSaved={() => refetchTemplates()}
            />
          </div>
        ))}
      </div>

      {drafts.length === 0 && !isCreating && readyAesthetics.length > 0 && (
        <p className="text-paper-3 text-sm">
          Pick an aesthetic and hit <span className="text-paper-2">Create Draft</span> — videos will be automatically assigned to each section.
        </p>
      )}
    </div>
  );
}

