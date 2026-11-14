import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { EmptyHome } from "@/components/EmptyHome";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
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
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={t("crumb")}
    >
      {ws.data.fieldCount === 0 ? (
        <EmptyHome firstName={me.data.name.split(/\s+/)[0] ?? me.data.name} />
      ) : (
        // The morning brief replaces this in EP-04 (S-04.03).
        <p className="text-body text-ink-2">{ws.data.fieldCount}</p>
      )}
    </AppShell>
  );
}
