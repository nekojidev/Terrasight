import { notFound } from "next/navigation";
import { serverGet } from "@/lib/server-api";
import type { ReportView } from "@/components/OwnerReport";
import { ReportLinkClient } from "./ReportLinkClient";

/** Design 16: the Owner report through a report link — no app chrome, read and answer only (S-08.03). */
export default async function ReportLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await serverGet<ReportView>(`/api/r/${encodeURIComponent(token)}`);
  if (!report.ok) notFound();
  return <ReportLinkClient token={token} initial={report.data} />;
}
