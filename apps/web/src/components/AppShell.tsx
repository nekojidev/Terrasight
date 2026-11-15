"use client";

import { BottomTabs, Button, SheetRow, Sidebar, TopBar, type NavItem } from "@terrasight/ui";
import {
  ClipboardList,
  FileText,
  Home,
  Languages,
  LogOut,
  Map,
  RefreshCw,
  Settings,
  Sparkles,
  Wind,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DecisionList } from "@terrasight/shared";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { api, setCookie } from "@/lib/api";
import { Brand } from "./Brand";
import { CommandPalette } from "./CommandPalette";
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
  // ⌘K / Ctrl+K opens the command palette from anywhere; the hint shows the key this device has.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchHint, setSearchHint] = useState("⌘K");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setSearchHint("Ctrl K");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Owners answer decisions: the nav shows how many need them (PD v2.9).
  const answers = user.role === "owner";
  const open = useQuery({
    queryKey: ["decisions", workspace.id, "all"],
    queryFn: () => api<DecisionList>(`/api/w/${workspace.id}/decisions?state=all`),
    enabled: answers,
    retry: false,
  });
  // A badge is a hint, not content: when the request fails the nav simply shows no count (silent).
  const needYou = answers ? (open.data?.counts.waiting ?? 0) : 0;

  const settingsHref = user.role === "owner" ? "/settings/workspace" : "/settings/account";
  const nav = {
    today: { href: "/", label: a("navToday"), icon: <Home />, active: path === "/" },
    fields: { href: "/fields", label: a("navFields"), icon: <Map />, active: path.startsWith("/fields") },
    plan: { href: "/rotation", label: a("navPlan"), icon: <RefreshCw />, active: path.startsWith("/rotation") },
    assistant: {
      href: "/assistant",
      label: a("navAssistant"),
      icon: <Sparkles />,
      active: path.startsWith("/assistant"),
    },
    decisions: {
      href: "/decisions",
      label: needYou > 0 ? a("navDecisionsNeed") : a("navDecisions"),
      icon: <FileText />,
      active: path.startsWith("/decisions"),
      ...(needYou > 0 ? { badge: needYou } : {}),
    },
  } satisfies Record<string, NavItem>;
  // Owner answers decisions, so they come first; the agronomist does field work, so Today leads (design review v5).
  const items: NavItem[] =
    user.role === "owner"
      ? [nav.decisions, nav.today, nav.fields, nav.plan, nav.assistant]
      : // The agronomist has no Decisions item: the owner's answer shows on the recommendation itself.
        [nav.today, nav.fields, nav.plan, nav.assistant];
  const settingsActive = path.startsWith("/settings");
  const bottomItems: NavItem[] = [
    { href: settingsHref, label: a("navSettings"), icon: <Settings />, active: settingsActive },
  ];
  const tabs: NavItem[] =
    user.role === "owner"
      ? [{ ...nav.decisions, label: a("navDecisions") }, nav.today, nav.fields, nav.assistant]
      : [nav.today, nav.fields, nav.plan, nav.assistant];
  const planInMore = user.role === "owner";
  const moreActive = settingsActive || (planInMore && nav.plan.active) || path.startsWith("/work-windows");

  const setLocale = (l: "uk" | "en") => {
    setCookie("ts_locale", l);
    router.refresh();
  };
  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST", noRefresh: true }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  };

  const moreRows = (
    <>
      {planInMore && <SheetRow href="/rotation" label={a("navPlan")} icon={<RefreshCw />} active={nav.plan.active} />}
      <SheetRow
        href="/work-windows"
        label={a("navWorkWindows")}
        icon={<Wind />}
        active={path.startsWith("/work-windows")}
      />
      {/* The work log belongs to a field: this opens the field list, where each field has its log tab. */}
      <SheetRow href="/fields" label={a("navWorkLog")} icon={<ClipboardList />} />
      <SheetRow href={settingsHref} label={a("navSettings")} icon={<Settings />} active={settingsActive} />
      <ThemeToggle row />
      <SheetRow
        label={a("langRow")}
        icon={<Languages />}
        trailing={locale === "uk" ? "UA" : "EN"}
        onSelect={() => setLocale(locale === "uk" ? "en" : "uk")}
      />
      <span data-sheet-close className="contents">
        <SheetRow label={a("signOut")} icon={<LogOut />} onSelect={() => void signOut()} />
      </span>
    </>
  );

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
                <span className="block truncate text-body font-semibold text-ink" title={workspace.name}>
                  {workspace.name}
                </span>
                <span className="block text-small text-ink-2">
                  {a("coFields", { n: workspace.fieldCount })}
                </span>
              </span>
            </div>
          }
          items={items}
          bottomItems={bottomItems}
          footer={
            <div className="sb-row flex items-center gap-3">
              <span className="inline-flex size-10 items-center justify-center rounded-chip bg-ink-2 text-small font-bold text-surface">
                {initials(user.name)}
              </span>
              <span className="sb-label min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink" title={user.name}>
                  {user.name}
                </span>
                <span className="block truncate text-small text-ink-2" title={a(`role_${user.role}`)}>
                  {a(`role_${user.role}`)}
                </span>
              </span>
              <ThemeToggle />
              <Button variant="icon" label={a("signOut")} icon={<LogOut />} onClick={() => void signOut()} />
            </div>
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumb={crumb}
          searchLabel={a("searchPh")}
          searchHint={searchHint}
          askShort={a("askShort")}
          onSearch={() => setPaletteOpen(true)}
          languageGroupLabel={t("lang_group")}
          languages={[
            { code: "uk", label: "UA", active: locale === "uk", onSelect: () => setLocale("uk") },
            { code: "en", label: "EN", active: locale === "en", onSelect: () => setLocale("en") },
          ]}
          extra={
            <>
              <NotificationsBell workspaceId={workspace.id} />
            </>
          }
        />
        <div className="sticky top-20 z-20 empty:hidden">
          <OfflineBanner />
        </div>
        <main className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-[calc(var(--ts-tabbar)+env(safe-area-inset-bottom)+1.5rem)] sm:px-8 sm:pt-10 lg:pb-10">
          {children}
        </main>
      </div>
      <CommandPalette
        workspaceId={workspace.id}
        role={user.role}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
      {/* Phones and tablets: (Decisions for the Owner) · Today · Fields · Assistant · More. */}
      <div className="lg:hidden">
        <BottomTabs
          label={t("nav_label")}
          items={tabs}
          more={{ label: a("navMore"), title: a("navMoreTitle"), closeLabel: a("toastDismiss"), active: moreActive, children: moreRows }}
        />
      </div>
    </div>
  );
}
