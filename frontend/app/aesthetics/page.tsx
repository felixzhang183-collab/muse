"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { getAesthetics, createAesthetic, deleteAesthetic, type Aesthetic } from "@/lib/api";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * 0.07, duration: 0.35, ease: [0.25, 0, 0, 1] },
  }),
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2 },
  },
};

function AestheticCard({ aesthetic, index }: { aesthetic: Aesthetic; index: number }) {
  const queryClient = useQueryClient();

  const del = useMutation({
    mutationFn: () => deleteAesthetic(aesthetic.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetics"] }),
  });

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className="bg-surface border border-sub p-5 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/aesthetics/${aesthetic.id}`}
            className="font-display text-base font-semibold tracking-wide uppercase hover:text-accent transition-colors"
          >
            {aesthetic.name}
          </Link>
          {aesthetic.description && (
            <p className="font-data text-sm text-paper-2 mt-0.5 line-clamp-2">{aesthetic.description}</p>
          )}
        </div>
        <motion.button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
          className="font-data text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 disabled:opacity-40"
        >
          {del.isPending ? "…" : "✕"}
        </motion.button>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-data text-xs text-paper-3">
          {aesthetic.video_count} video{aesthetic.video_count !== 1 ? "s" : ""}
        </span>
        <Link
          href={`/aesthetics/${aesthetic.id}`}
          className="font-display text-xs tracking-wider uppercase bg-surface-2 hover:bg-sub text-paper-2 hover:text-paper px-3 py-1 border border-sub transition-colors"
        >
          Open →
        </Link>
      </div>
    </motion.div>
  );
}

const formVariants: Variants = {
  hidden: { opacity: 0, height: 0, marginBottom: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    marginBottom: 32,
    transition: { duration: 0.35, ease: [0.25, 0, 0, 1] },
  },
  exit: {
    opacity: 0,
    height: 0,
    marginBottom: 0,
    transition: { duration: 0.25, ease: [0.4, 0, 1, 1] },
  },
};

export default function AestheticsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);

  const { data: aesthetics = [], isLoading } = useQuery({
    queryKey: ["aesthetics"],
    queryFn: getAesthetics,
  });

  const create = useMutation({
    mutationFn: () => createAesthetic({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aesthetics"] });
      setName("");
      setDescription("");
      setShowForm(false);
    },
  });

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between mb-8"
      >
        <div>
          <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Aesthetics</h1>
          <div className="h-[2px] w-8 bg-accent mt-2" />
          <p className="font-data text-sm text-paper-2 mt-3">
            Curate video pools by visual vibe, then render songs against them
          </p>
        </div>
        <motion.button
          onClick={() => setShowForm((v) => !v)}
          whileTap={{ scale: 0.97 }}
          animate={{ rotate: showForm ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className="font-display text-xs tracking-[0.15em] uppercase bg-paper text-ink font-bold px-4 py-2 hover:bg-paper-2 hover:text-ink transition-colors"
        >
          + New
        </motion.button>
      </motion.div>

      {/* create form — animates open/closed */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            variants={formVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ overflow: "hidden" }}
            className="border border-sub p-5"
          >
            <h2 className="font-display text-xs tracking-[0.2em] uppercase text-paper-2 mb-4">
              Create Aesthetic
            </h2>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name — e.g. Dark Moody Cinematic"
                className="bg-surface border border-sub px-4 py-2 font-data text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors"
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="bg-surface border border-sub px-4 py-2 font-data text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors"
              />
              <div className="flex gap-3 items-center">
                <motion.button
                  onClick={() => create.mutate()}
                  disabled={!name.trim() || create.isPending}
                  whileTap={{ scale: 0.97 }}
                  className="bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold px-5 py-2 disabled:opacity-30 hover:bg-accent-dark transition-colors"
                >
                  {create.isPending ? "Creating…" : "Create"}
                </motion.button>
                <button
                  onClick={() => setShowForm(false)}
                  className="font-data text-sm text-paper-3 hover:text-paper transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <p className="font-data text-sm text-paper-3">Loading…</p>
      ) : aesthetics.length === 0 ? (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="font-data text-sm text-paper-3"
        >
          No aesthetics yet. Create one to start building a video pool.
        </motion.p>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <AnimatePresence>
            {aesthetics.map((a, i) => (
              <AestheticCard key={a.id} aesthetic={a} index={i} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
