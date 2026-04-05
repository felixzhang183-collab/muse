"use client";

import "./globals.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { getMe, logout } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

const NAV_LINKS = [
  { href: "/songs", label: "Songs" },
  { href: "/aesthetics", label: "Aesthetics" },
  { href: "/videos", label: "Library" },
  { href: "/tiktok", label: "TikTok" },
  { href: "/analytics", label: "Analytics" },
];

function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    if (token && !user) {
      getMe().then(setUser).catch(() => {
        localStorage.removeItem("token");
        if (pathname !== "/auth") router.push("/auth");
      });
    } else if (!token && pathname !== "/auth") {
      router.push("/auth");
    }
  }, [pathname]);

  function handleLogout() {
    logout();
    setUser(null);
    router.push("/auth");
  }

  return (
    <nav className="border-b border-sub flex items-stretch px-6 overflow-x-auto">
      <Link
        href="/"
        className="font-display text-sm font-bold tracking-[0.2em] text-paper uppercase mr-8 flex items-center py-4 shrink-0 hover:text-accent transition-colors"
      >
        MUSE
      </Link>

      <LayoutGroup>
        <div className="flex items-stretch gap-0.5">
          {NAV_LINKS.map(({ href, label }, i) => {
            const active = pathname?.startsWith(href);
            return (
              <motion.div
                key={href}
                initial={mounted ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                className="relative flex items-stretch"
              >
                <Link
                  href={href}
                  className={`relative flex items-center px-3 font-display text-xs tracking-[0.15em] uppercase transition-colors shrink-0 ${
                    active ? "text-paper" : "text-paper-2 hover:text-paper"
                  }`}
                >
                  {label}
                  {active && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent"
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>

      <div className="ml-auto flex items-center gap-5 shrink-0">
        <AnimatePresence mode="wait">
          {user ? (
            <motion.div
              key="user"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-5"
            >
              <span className="font-display text-xs text-paper-3 tracking-[0.12em] uppercase hidden sm:block">
                {user.artist_name}
              </span>
              <button
                onClick={handleLogout}
                className="font-display text-xs text-paper-2 hover:text-accent transition-colors tracking-[0.12em] uppercase"
              >
                Out
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="signin"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.2 }}
            >
              <Link
                href="/auth"
                className="font-display text-xs text-paper-2 hover:text-paper transition-colors tracking-[0.12em] uppercase"
              >
                Sign In
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}

function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  }));

  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-paper">
        <QueryClientProvider client={queryClient}>
          <Nav />
          <main className="max-w-5xl mx-auto px-6 py-10">
            <PageTransition>{children}</PageTransition>
          </main>
        </QueryClientProvider>
      </body>
    </html>
  );
}
