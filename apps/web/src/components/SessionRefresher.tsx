"use client";

import { Skeleton } from "@terrasight/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/**
 * Server components can't refresh an expired access token (the refresh cookie is scoped to /api/auth).
 * This tries one refresh in the browser, then reloads the page data or sends the user to sign in (with a notice).
 */
export function SessionRefresher({ next }: { next: string }) {
  const router = useRouter();
  const t = useTranslations("App");
  useEffect(() => {
    const expired = () => router.replace(`/login?expired=1&next=${encodeURIComponent(next)}`);
    void fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then((r) => (r.ok ? router.refresh() : expired()))
      .catch(expired);
  }, [next, router]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-4 px-6">
      <p role="status" aria-live="polite" className="text-body text-ink-2">
        {t("sessionRefreshing")}
      </p>
      <Skeleton label={t("sessionRefreshing")} />
    </main>
  );
}
