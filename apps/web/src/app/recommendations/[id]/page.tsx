import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { RecommendationClient, type RecView } from "./RecommendationClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  timeZone: string;
  role: Me["workspaces"][number]["role"];
}

/** Design 09: recommendation detail (S-04.06). */
export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next={`/recommendations/${id}`} />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, rec] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<RecView>(`/api/w/${active.id}/recommendations/${id}`),
  ]);
  if (!ws.ok) redirect("/");
  if (!rec.ok) notFound();
  const t = await getTranslations("Rec");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      <RecommendationClient
        workspaceId={ws.data.id}
        timeZone={ws.data.timeZone}
        canAct={ws.data.role !== "viewer"}
        initial={rec.data}
      />
    </AppShell>
  );
}
