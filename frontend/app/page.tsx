"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token && !user) {
      router.replace("/auth");
    } else {
      router.replace("/songs");
    }
  }, []);

  return null;
}
