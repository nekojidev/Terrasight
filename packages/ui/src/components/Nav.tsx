"use client";

import { clsx } from "clsx";
import { Bell, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
}

function Badge({ n, collapsed }: { n: number; collapsed?: boolean }) {
  if (collapsed) {
    // Rail: a dot on the icon; the count stays in the text for screen readers.
    return (
      <span className="absolute top-2 right-2 size-2.5 overflow-hidden rounded-chip bg-urgent text-[0px]">{n}</span>
    );
  }
  return (
    <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-chip bg-urgent px-1.5 text-[12px] font-semibold text-surface">
      {n}
    </span>
  );
}

/**
 * Sidebar: active item = muted fill + lime inset bar (design/README §3).
 * `collapsed` = 72 px icon rail. Descendants marked `.sb-label` (text), `.sb-row` (flex rows) and `.sb-card`
 * (framed cards) adapt to the rail through the `data-collapsed` attribute.
 */
export function Sidebar({
  brand,
  company,
  items,
  footer,
  label,
  collapsed = false,
  onToggle,
  toggleLabel,
}: {
  brand: ReactNode;
  company?: ReactNode;
  items: NavItem[];
  footer?: ReactNode;
  label: string;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Accessible name of the toggle: the action it performs ("Collapse sidebar" / "Expand sidebar"). */
  toggleLabel?: string;
}) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      data-collapsed={collapsed}
      className={clsx(
        "flex h-full flex-col gap-6 border-r border-line bg-surface motion-safe:transition-[width,padding] motion-safe:duration-[var(--ts-sheet)] motion-safe:ease-[var(--ts-ease)]",
        collapsed ? "w-[72px] p-3" : "w-64 p-4",
        "data-[collapsed=true]:[&_.sb-label]:sr-only data-[collapsed=true]:[&_.sb-row]:flex-col",
        "data-[collapsed=true]:[&_.sb-card]:justify-center data-[collapsed=true]:[&_.sb-card]:border-transparent data-[collapsed=true]:[&_.sb-card]:bg-transparent data-[collapsed=true]:[&_.sb-card]:p-0",
      )}
    >
      <div className={clsx("flex gap-3", collapsed ? "flex-col items-center" : "items-center justify-between px-2")}>
        {brand}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            title={toggleLabel}
            className="focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-btn text-ink-2 hover:bg-surface-2"
          >
            <ToggleIcon aria-hidden className="size-5" strokeWidth={1.7} />
          </button>
        )}
      </div>
      {company}
      <nav aria-label={label}>
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li key={it.href} className="group relative">
              <a
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={clsx(
                  "focus-ring relative flex min-h-tap items-center gap-3 overflow-hidden rounded-btn px-3 text-body",
                  collapsed && "justify-center",
                  it.active
                    ? "bg-muted font-semibold text-ink shadow-[inset_3px_0_0_var(--ts-signal)]"
                    : "text-ink-2 hover:bg-surface-2",
                )}
              >
                <span aria-hidden className="shrink-0 [&>svg]:size-5 [&>svg]:stroke-[1.7]">
                  {it.icon}
                </span>
                <span className={clsx("whitespace-nowrap", collapsed && "sr-only")}>{it.label}</span>
                {it.badge ? <Badge n={it.badge} collapsed={collapsed} /> : null}
              </a>
              {collapsed && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 -translate-y-1/2 rounded-btn bg-ink px-3 py-1.5 text-small whitespace-nowrap text-surface opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-150"
                >
                  {it.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
      {footer && <div className="mt-auto border-t border-line pt-4">{footer}</div>}
    </aside>
  );
}

export interface TopBarProps {
  crumb: string;
  searchLabel: string;
  onSearch: () => void;
  languages: Array<{ code: string; label: string; active: boolean; onSelect: () => void }>;
  languageGroupLabel: string;
  /** Bell is rendered only when notifications are backed by real data. */
  notificationsLabel?: string;
  hasNotifications?: boolean;
  onNotifications?: () => void;
  /** Extra control before notifications (e.g. the theme toggle on phones). */
  extra?: ReactNode;
}

/** Top bar: crumb, ⌘K search, UA/EN switch, notifications. */
export function TopBar(p: TopBarProps) {
  return (
    <header className="flex h-20 items-center gap-4 border-b border-line bg-bg px-8">
      <span className="flex-1 text-body font-semibold text-ink">{p.crumb}</span>
      <button
        type="button"
        onClick={p.onSearch}
        className="focus-ring flex min-h-tap w-auto max-w-full items-center sm:w-[450px] gap-3 rounded-input border border-line bg-surface px-4 text-left text-body text-ink-3"
      >
        <Search aria-hidden className="size-5" strokeWidth={1.7} />
        <span className="sr-only sm:not-sr-only sm:flex-1">{p.searchLabel}</span>
        <kbd className="hidden rounded-[6px] sm:inline border border-line px-1.5 font-mono text-[12px]">
          ⌘K
        </kbd>
      </button>
      <div
        role="group"
        aria-label={p.languageGroupLabel}
        className="flex rounded-input border border-line bg-surface p-1"
      >
        {p.languages.map((l) => (
          <button
            key={l.code}
            type="button"
            aria-pressed={l.active}
            onClick={l.onSelect}
            className={clsx(
              "focus-ring min-h-tap rounded-btn px-3 text-body font-semibold",
              l.active ? "bg-bg text-ink" : "text-ink-2",
            )}
          >
            {l.label}
          </button>
        ))}
      </div>
      {p.extra}
      {p.notificationsLabel && p.onNotifications && (
        <button
          type="button"
          aria-label={p.notificationsLabel}
          onClick={p.onNotifications}
          className="focus-ring relative inline-flex size-11 items-center justify-center rounded-btn border border-line bg-surface"
        >
          <Bell aria-hidden className="size-5" strokeWidth={1.7} />
          {p.hasNotifications && (
            <span className="absolute top-2.5 right-2.5 size-2 rounded-chip bg-urgent" />
          )}
        </button>
      )}
    </header>
  );
}

/** Phone navigation (design 05): Home · Fields · Assistant · Reports. */
export function BottomTabs({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {items.map((it) => (
          <li key={it.href} className="flex-1">
            <a
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={clsx(
                "focus-ring flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px]",
                it.active ? "font-semibold text-ink" : "text-ink-3",
              )}
            >
              <span aria-hidden className="[&>svg]:size-5 [&>svg]:stroke-[1.7]">
                {it.icon}
              </span>
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
