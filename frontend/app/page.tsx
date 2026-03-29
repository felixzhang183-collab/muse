import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
      <h1 className="text-4xl font-bold tracking-tight">Music Marketing Tool</h1>
      <p className="text-zinc-400 max-w-md">
        Upload a track, discover matching video clips, auto-generate beat-synced edits, and
        schedule posts — all in one place.
      </p>
      <div className="flex gap-3">
        <Link
          href="/songs"
          className="px-5 py-2.5 bg-white text-black rounded-lg font-medium text-sm hover:bg-zinc-200 transition-colors"
        >
          View Songs
        </Link>
        <Link
          href="/songs/upload"
          className="px-5 py-2.5 bg-zinc-800 text-white rounded-lg font-medium text-sm hover:bg-zinc-700 transition-colors"
        >
          Upload Track
        </Link>
      </div>
    </div>
  );
}
