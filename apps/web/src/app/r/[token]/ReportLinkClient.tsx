"use client";

import type { Decision, PublicDecisions } from "@terrasight/shared";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { api } from "@/lib/api";

/** The owner's decisions through the link: one column, phone first, no sign-in. */
export function ReportLinkClient({ token, initial }: { token: string; initial: PublicDecisions }) {
  const [data, setData] = useState(initial);
  const base = `/api/r/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[560px] bg-bg px-4 py-6 md:py-10">
      <div className="mb-5">
        <Brand />
      </div>
      <OwnerDecisions
        standalone
        items={data.items}
        language={data.language}
        workspaceName={data.workspaceName}
        onAnswer={async (id, answer, text) => {
          const saved = await api<Decision>(`${base}/decisions/${id}/answer`, {
            body: { answer, ...(text ? { text } : {}) },
            noRefresh: true,
          });
          // Refresh quietly; a failure here must not undo the saved answer.
          void api<PublicDecisions>(base, { noRefresh: true }).then(setData, () => undefined);
          return saved;
        }}
      />
    </main>
  );
}
