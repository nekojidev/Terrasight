"use client";

import type { Decision, PublicDecisions } from "@terrasight/shared";
import { useState } from "react";
import { OwnerDecisions } from "@/components/OwnerDecisions";
import { api } from "@/lib/api";

export function ReportLinkClient({ token, initial }: { token: string; initial: PublicDecisions }) {
  const [data, setData] = useState(initial);
  const base = `/api/r/${encodeURIComponent(token)}`;
  return (
    <main className="mx-auto min-h-dvh max-w-[430px] bg-canvas p-4 md:max-w-[560px] md:py-8">
      <OwnerDecisions
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
