import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { AssistantClient } from "./AssistantClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  role: Me["workspaces"][number]["role"];
}

/** Design 14: the assistant (S-05.05). `?field=<id>` opens that field's latest chat (or a new one), `?rec=<id>` a new one; `?q=` sends a question (⌘K palette). */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string; rec?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/assistant" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  const t = await getTranslations("Assistant");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      <AssistantClient
        workspaceId={ws.data.id}
        fieldCount={ws.data.fieldCount}
        question={sp.q?.trim().slice(0, 2000) || undefined}
        context={{
          ...(sp.field ? { fieldId: sp.field } : {}),
          ...(sp.rec ? { recommendationId: sp.rec } : {}),
        }}
      />
    </AppShell>
  );
}
