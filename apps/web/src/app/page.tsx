import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { Brief } from "@/components/Brief";
import { EmptyHome } from "@/components/EmptyHome";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
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

  return (
    <AppShell
      workspace={{ id: ws.data.id, name: ws.data.name, fieldCount: ws.data.fieldCount }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      {ws.data.fieldCount === 0 ? (
        <EmptyHome firstName={me.data.name.split(/\s+/)[0] ?? me.data.name} />
      ) : (
        <Brief
          workspaceId={ws.data.id}
          firstName={me.data.name.split(/\s+/)[0] ?? me.data.name}
          units={ws.data.units}
          canAct
          isOwner={ws.data.role === "owner"}
          canAsk={ws.data.role !== "owner"}
        />
      )}
    </AppShell>
  );
}
