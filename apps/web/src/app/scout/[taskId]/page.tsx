import { notFound, redirect } from "next/navigation";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { ScoutClient, type ScoutTask } from "./ScoutClient";

/** Design 12: the field check on a phone (S-07.02). Full screen, no sidebar. */
export default async function ScoutPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next={`/scout/${taskId}`} />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const task = await serverGet<ScoutTask>(`/api/w/${active.id}/scouting-tasks/${taskId}`);
  if (!task.ok) notFound();
  // The field's country picks the units (US: feet / miles). Best effort: metric when it is not available.
  const rec = await serverGet<{ fieldId: string }>(
    `/api/w/${active.id}/recommendations/${task.data.recommendationId}`,
  );
  const field = rec.ok
    ? await serverGet<{ country?: string | null }>(`/api/w/${active.id}/fields/${rec.data.fieldId}`)
    : null;
  return (
    <ScoutClient
      workspaceId={active.id}
      initial={task.data}
      country={field?.ok ? (field.data.country ?? undefined) : undefined}
    />
  );
}
