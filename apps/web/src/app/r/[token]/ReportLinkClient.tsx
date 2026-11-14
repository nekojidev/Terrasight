"use client";

import { useState } from "react";
import { OwnerReport, type ReportView } from "@/components/OwnerReport";
import { api } from "@/lib/api";

export function ReportLinkClient({ token, initial }: { token: string; initial: ReportView }) {
  const [report, setReport] = useState(initial);
  return (
    <main className="mx-auto min-h-dvh max-w-[430px] bg-canvas p-4">
      <OwnerReport
        report={report}
        onAnswer={async (id, answer, text) => {
          await api(`/api/r/${encodeURIComponent(token)}/items/${id}/answers`, {
            body: { answer, ...(text ? { text } : {}) },
            noRefresh: true,
          });
          setReport(await api<ReportView>(`/api/r/${encodeURIComponent(token)}`, { noRefresh: true }));
        }}
      />
    </main>
  );
}
