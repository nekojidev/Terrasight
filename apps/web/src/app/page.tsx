import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { AnalysisCard } from "@/components/AnalysisCard";
import { EmptyHome } from "@/components/EmptyHome";
import { FieldList, type FieldRow } from "@/components/FieldList";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
  units: "metric" | "imperial";
  timeZone: string;
  role: Me["workspaces"][number]["role"];
}

/**
 * "/": signed out → login; no company → onboarding; no fields → empty home (design 03);
 * otherwise the morning brief (design 04, EP-04).
 */
export default async function Home() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/onboarding");
  const t = await getTranslations("EmptyHome");
  const fields = ws.data.fieldCount > 0 ? await serverGet<FieldRow[]>(`/api/w/${active.id}/fields`) : null;

  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      {ws.data.fieldCount === 0 ? (
        <EmptyHome firstName={me.data.name.split(/\s+/)[0] ?? me.data.name} />
      ) : (
        // The morning brief replaces this in EP-04 (S-04.03).
        <div className="flex flex-col gap-6">
          <AnalysisCard
            workspaceId={ws.data.id}
            timeZone={ws.data.timeZone}
            canRun={ws.data.role !== "viewer"}
          />
          <FieldList
            fields={fields?.ok ? fields.data : []}
            units={ws.data.units}
            canEdit={ws.data.role !== "viewer"}
          />
        </div>
      )}
    </AppShell>
  );
}
