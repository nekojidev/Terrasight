import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { FieldsOverview, type FieldsOverviewData } from "./FieldsOverview";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Design 07: fields by county with the region map (S-04.08). */
export default async function FieldsPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/fields" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, fields] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<FieldsOverviewData>(`/api/w/${active.id}/fields-overview`),
  ]);
  if (!ws.ok) redirect("/");
  if (ws.data.fieldCount === 0 && ws.data.role !== "viewer") redirect("/fields/new");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("fieldsTitle")}
    >
      {fields.ok ? (
        <FieldsOverview data={fields.data} units={ws.data.units} canEdit={ws.data.role !== "viewer"} />
      ) : (
        <p className="text-body text-urgent">{t("errGeneric")}</p>
      )}
    </AppShell>
  );
}
