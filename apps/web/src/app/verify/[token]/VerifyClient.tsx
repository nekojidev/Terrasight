"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

export function VerifyClient({ token }: { token: string }) {
  const a = useTranslations("App");
  const [state, setState] = useState<"working" | "ok" | "invalid" | "error">("working");
  const started = useRef(false);

  useEffect(() => {
    // The link is single use: React strict mode must not spend it twice.
    if (started.current) return;
    started.current = true;
    api(`/api/auth/verify/${encodeURIComponent(token)}`, { method: "POST", noRefresh: true })
      .then(() => setState("ok"))
      .catch((e: unknown) => setState(e instanceof ApiError && e.code === "verify-link-invalid" ? "invalid" : "error"));
  }, [token]);

  if (state === "working") return <p className="text-body text-ink-2" aria-busy="true" />;
  return (
    <div className="flex flex-col gap-5">
      <p role={state === "ok" ? "status" : "alert"} className="text-body text-ink">
        {state === "ok" ? a("verifyOk") : state === "invalid" ? a("verifyInvalid") : a("errGeneric")}
      </p>
      <Link
        href="/"
        className="focus-ring inline-flex min-h-14 items-center justify-center rounded-btn bg-ink px-6 text-body font-semibold text-surface"
      >
        {a("verifyContinue")}
      </Link>
    </div>
  );
}
