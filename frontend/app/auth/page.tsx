"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, register } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

const inputCls =
  "w-full bg-surface border border-sub px-3 py-2.5 text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors font-data";

const labelCls = "block font-display text-xs text-paper-2 mb-1.5 tracking-[0.15em] uppercase";

export default function AuthPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [artistName, setArtistName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let data;
      if (mode === "login") {
        data = await login(email, password);
      } else {
        data = await register({ email, password, display_name: displayName, artist_name: artistName });
      }
      setUser(data.user);
      router.push("/songs");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <h1 className="font-display text-4xl font-bold tracking-wider uppercase">
        {mode === "login" ? "Sign In" : "Create Account"}
      </h1>
      <div className="h-[2px] w-8 bg-accent mt-2 mb-8" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
        </div>

        {mode === "register" && (
          <>
            <div>
              <label className={labelCls}>Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Artist Name</label>
              <input
                type="text"
                required
                value={artistName}
                onChange={(e) => setArtistName(e.target.value)}
                className={inputCls}
              />
            </div>
          </>
        )}

        {error && (
          <p className="text-xs text-accent border border-accent/30 bg-accent/5 px-3 py-2 font-data">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="px-5 py-3 bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold disabled:opacity-30 hover:bg-accent-dark transition-colors mt-1"
        >
          {loading ? "…" : mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>

      <p className="text-xs text-paper-2 mt-6 tracking-wide font-data">
        {mode === "login" ? "No account?" : "Already have one?"}{" "}
        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
          className="text-paper hover:text-accent transition-colors underline underline-offset-2"
        >
          {mode === "login" ? "Register" : "Sign In"}
        </button>
      </p>
    </div>
  );
}
