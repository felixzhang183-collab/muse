"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { getAesthetics, createAesthetic, deleteAesthetic, type Aesthetic } from "@/lib/api";

function AestheticCard({ aesthetic }: { aesthetic: Aesthetic }) {
  const queryClient = useQueryClient();

  const del = useMutation({
    mutationFn: () => deleteAesthetic(aesthetic.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["aesthetics"] }),
  });

  return (
    <div className="bg-surface border border-sub p-5 flex flex-col gap-3">
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
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="font-data text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 disabled:opacity-40"
        >
          {del.isPending ? "…" : "✕"}
        </button>
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
    </div>
  );
}

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
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-5xl font-bold tracking-wider uppercase">Aesthetics</h1>
          <div className="h-[2px] w-8 bg-accent mt-2" />
          <p className="font-data text-sm text-paper-2 mt-3">
            Curate video pools by visual vibe, then render songs against them
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="font-display text-xs tracking-[0.15em] uppercase bg-paper text-ink font-bold px-4 py-2 hover:bg-paper-2 hover:text-ink transition-colors"
        >
          + New Aesthetic
        </button>
      </div>

      {showForm && (
        <div className="border border-sub p-5 mb-8">
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
              <button
                onClick={() => create.mutate()}
                disabled={!name.trim() || create.isPending}
                className="bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold px-5 py-2 disabled:opacity-30 hover:bg-accent-dark transition-colors"
              >
                {create.isPending ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="font-data text-sm text-paper-3 hover:text-paper transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="font-data text-sm text-paper-3">Loading…</p>
      ) : aesthetics.length === 0 ? (
        <p className="font-data text-sm text-paper-3">
          No aesthetics yet. Create one to start building a video pool.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {aesthetics.map((a) => (
            <AestheticCard key={a.id} aesthetic={a} />
          ))}
        </div>
      )}
    </div>
  );
}
