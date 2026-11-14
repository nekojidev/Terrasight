import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { AddFieldClient } from "./AddFieldClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Design 13: add a field (S-02.01). */
export default async function AddFieldPage() {
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next="/fields/new" />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const ws = await serverGet<WorkspaceDetail>(`/api/w/${active.id}`);
  if (!ws.ok) redirect("/");
  if (ws.data.role === "viewer") redirect("/");
  const t = await getTranslations("AddField");
  const a = await getTranslations("App");

  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb_a")}
    >
      <AddFieldClient
        workspaceId={ws.data.id}
        units={ws.data.units}
        suggestedName={a("suggestedFieldName", { n: ws.data.fieldCount + 1 })}
      />
    </AppShell>
  );
}
