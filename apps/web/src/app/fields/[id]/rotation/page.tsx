import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SessionRefresher } from "@/components/SessionRefresher";
import { activeWorkspace, serverGet, type Me } from "@/lib/server-api";
import { RotationClient } from "./RotationClient";

interface WorkspaceDetail {
  id: string;
  name: string;
  fieldCount: number;
  isDemo: boolean;
  units: "metric" | "imperial";
  role: Me["workspaces"][number]["role"];
}

/** Design 10: rotation options for the next season (S-06.04). */
export default async function RotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await serverGet<Me>("/api/me");
  if (!me.ok) {
    if (me.status === 401) return <SessionRefresher next={`/fields/${id}/rotation`} />;
    redirect("/login");
  }
  const active = await activeWorkspace(me.data);
  if (!active) redirect("/onboarding");
  const [ws, field] = await Promise.all([
    serverGet<WorkspaceDetail>(`/api/w/${active.id}`),
    serverGet<{ id: string; name: string }>(`/api/w/${active.id}/fields/${id}`),
  ]);
  if (!ws.ok) redirect("/");
  if (!field.ok) notFound();
  const t = await getTranslations("Rotation");
  return (
    <AppShell
      workspace={{ name: ws.data.name, fieldCount: ws.data.fieldCount, isDemo: ws.data.isDemo }}
      user={{ name: me.data.name, role: ws.data.role }}
      crumb={`${field.data.name} / ${t("crumb_r")}`}
    >
      <RotationClient
        workspaceId={ws.data.id}
        fieldId={id}
        fieldName={field.data.name}
        units={ws.data.units}
        canSave={ws.data.role !== "viewer"}
      />
    </AppShell>
  );
}
