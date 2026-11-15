import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { RotationsOverview, type Overview } from "./RotationsOverview";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Sidebar "Rotations": every field's decision for the next season (RFC §7.7) and the way into its options. */
export default async function RotationPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/rotation" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, overview] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<Overview>(`/api/w/${active.id}/rotations`),
  ]);
  if (!ws.ok) redirect("/");
  const t = await getTranslations("App");
  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("rvTitle")}
    >
      {overview.ok ? (
        <RotationsOverview overview={overview.data} units={ws.data.units} />
      ) : (
        <p className="text-body text-urgent">{t("errGeneric")}</p>
      )}
    </AppShell>
  );
}
