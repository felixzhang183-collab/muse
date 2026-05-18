"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeTikTokCode } from "@/lib/api";

type State = "exchanging" | "success" | "error";

function TikTokCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>("exchanging");
  const [error, setError] = useState<string | null>(null);
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = searchParams.get("code");
    const stateParam = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(errorParam === "access_denied" ? "You declined the TikTok authorization." : errorParam);
      setState("error");
      return;
    }

    if (!code || !stateParam) {
      setError("Missing authorization code. Please try connecting again.");
      setState("error");
      return;
    }

    exchangeTikTokCode(code, stateParam)
      .then(() => {
        setState("success");
        setTimeout(() => router.replace("/tiktok"), 1500);
      })
      .catch((err: Error) => {
        setError(err.message);
        setState("error");
      });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
      {state === "exchanging" && (
        <>
          <div className="w-1 h-1 bg-accent rounded-full animate-ping mb-6" />
          <p className="font-display text-xs tracking-[0.2em] uppercase text-paper-2">
            Connecting TikTok…
          </p>
        </>
      )}

      {state === "success" && (
        <>
          <div className="w-2 h-2 bg-accent mb-6" />
          <p className="font-display text-xs tracking-[0.2em] uppercase text-paper">
            Connected
          </p>
          <p className="font-data text-xs text-paper-3 mt-2">Redirecting…</p>
        </>
      )}

      {state === "error" && (
        <>
          <div className="w-2 h-2 bg-red-400 mb-6" />
          <p className="font-display text-xs tracking-[0.2em] uppercase text-red-400 mb-3">
            Connection failed
          </p>
          <p className="font-data text-xs text-paper-2 mb-6 max-w-xs">{error}</p>
          <button
            onClick={() => router.replace("/tiktok")}
            className="font-display text-xs tracking-[0.15em] uppercase border border-sub text-paper-2 px-4 py-2 hover:border-paper-2 hover:text-paper transition-colors"
          >
            Back to TikTok
          </button>
        </>
      )}
    </div>
  );
}

export default function TikTokCallbackPage() {
  return (
    <Suspense>
      <TikTokCallbackInner />
    </Suspense>
  );
}
