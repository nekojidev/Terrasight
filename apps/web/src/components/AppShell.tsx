"use client";

import { BottomTabs, Sidebar, TopBar, type NavItem } from "@terrasight/ui";
import { FileText, Home, LogOut, Map, RefreshCw, Sparkles, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DecisionList } from "@terrasight/shared";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { api, setCookie } from "@/lib/api";
import { Brand } from "./Brand";
import { NotificationsBell } from "./NotificationsBell";
import { OfflineBanner } from "./OfflineBanner";
import { useSidebarState } from "./SidebarState";
import { ThemeToggle } from "./ThemeToggle";

export interface ShellWorkspace {
  id: string;
  name: string;
  fieldCount: number;
}

export interface ShellUser {
  name: string;
  role: "owner" | "agronomist";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Desktop shell (design 03/04): sidebar with company card, top bar with search and UA/EN and the notifications bell. */
export function AppShell({
  workspace,
  user,
  crumb,
  children,
}: {
  workspace: ShellWorkspace;
  user: ShellUser;
  crumb: string;
  children: ReactNode;
}) {
  const t = useTranslations("EmptyHome");
  const a = useTranslations("App");
  const locale = useLocale();
  const router = useRouter();
  const path = usePathname();
  const { collapsed, toggle } = useSidebarState();

  // Owners answer decisions: the nav shows how many need them (PD v2.9).
  const answers = user.role === "owner";
  const open = useQuery({
    queryKey: ["decisions", workspace.id, "all"],
    queryFn: () => api<DecisionList>(`/api/w/${workspace.id}/decisions?state=all`),
    enabled: answers,
  });
  const needYou = answers ? (open.data?.counts.waiting ?? 0) : 0;

  const items: NavItem[] = [
    { href: "/", label: t("n_today"), icon: <Home />, active: path === "/" },
    { href: "/fields", label: t("n_fields"), icon: <Map />, active: path.startsWith("/fields") },
    { href: "/rotation", label: t("n_rot"), icon: <RefreshCw />, active: path.startsWith("/rotation") },
    { href: "/assistant", label: t("n_ai"), icon: <Sparkles />, active: path.startsWith("/assistant") },
    {
      href: "/decisions",
      label: needYou > 0 ? a("navDecisionsNeed") : a("navDecisions"),
      icon: <FileText />,
      active: path.startsWith("/decisions"),
      ...(needYou > 0 ? { badge: needYou } : {}),
    },
    ...(user.role === "owner"
      ? [
          {
            href: "/settings/team",
            label: a("navTeam"),
            icon: <Users />,
            active: path.startsWith("/settings/team"),
          },
        ]
      : []),
  ];

  const setLocale = (l: "uk" | "en") => {
    setCookie("ts_locale", l);
    router.refresh();
  };
  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST", noRefresh: true }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar
          label={t("nav_label")}
          collapsed={collapsed}
          onToggle={toggle}
          toggleLabel={a(collapsed ? "sidebarExpand" : "sidebarCollapse")}
          brand={<Brand />}
          company={
            <div className="sb-card flex items-center gap-3 rounded-card border border-line bg-surface-2 p-3">
              <span className="inline-flex size-10 items-center justify-center rounded-btn bg-ink text-small font-bold text-surface">
                {initials(workspace.name)}
              </span>
              <span className="sb-label min-w-0">
                <span className="block truncate text-body font-semibold text-ink">{workspace.name}</span>
                <span className="block text-small text-ink-2">
                  {a("coFields", { n: workspace.fieldCount })}
                </span>
              </span>
            </div>
          }
          items={items}
          footer={
            <div className="sb-row flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-chip bg-ink-2 text-small font-bold text-surface">
                {initials(user.name)}
              </span>
              <span className="sb-label min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink">{user.name}</span>
                <span className="block text-small text-ink-2">{a(`role_${user.role}`)}</span>
              </span>
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label={a("signOut")}
                title={a("signOut")}
                className="focus-ring inline-flex size-11 items-center justify-center rounded-btn text-ink-2 hover:bg-surface-2"
              >
                <LogOut aria-hidden className="size-5" strokeWidth={1.7} />
              </button>
            </div>
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumb={crumb}
          searchLabel={t("search")}
          onSearch={() => router.push("/assistant")}
          languageGroupLabel={t("lang_group")}
          languages={[
            { code: "uk", label: "UA", active: locale === "uk", onSelect: () => setLocale("uk") },
            { code: "en", label: "EN", active: locale === "en", onSelect: () => setLocale("en") },
          ]}
          extra={
            <>
              <ThemeToggle className="lg:hidden" />
              <NotificationsBell workspaceId={workspace.id} />
            </>
          }
        />
        <main className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-24 sm:px-8 sm:py-10 lg:pb-10">
          <div className="mb-4 empty:hidden">
            <OfflineBanner />
          </div>
          {children}
        </main>
      </div>
      {/* Phones and tablets: bottom tabs Home · Fields · Assistant · Reports (design 05). */}
      <div className="lg:hidden">
        <BottomTabs label={t("nav_label")} items={items.filter((i) => i.href !== "/rotation")} />
      </div>
    </div>
  );
}
