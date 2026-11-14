"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Server components can't refresh an expired access token (the refresh cookie is scoped to /api/auth).
 * This tries one refresh in the browser, then reloads the page data or sends the user to sign in.
 */
export function SessionRefresher({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    void fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then((r) => (r.ok ? router.refresh() : router.replace(`/login?next=${encodeURIComponent(next)}`)))
      .catch(() => router.replace(`/login?next=${encodeURIComponent(next)}`));
  }, [next, router]);
  return <div role="status" aria-busy="true" className="min-h-dvh" />;
}
