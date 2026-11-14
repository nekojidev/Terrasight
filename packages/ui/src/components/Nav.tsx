"use client";

import { clsx } from "clsx";
import { Bell, Search } from "lucide-react";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  badge?: number;
}

function Badge({ n }: { n: number }) {
  return (
    <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-chip bg-urgent px-1.5 text-[12px] font-semibold text-surface">
      {n}
    </span>
  );
}

/** Sidebar: active item = muted fill + lime inset bar (design/README §3). */
export function Sidebar({
  brand,
  company,
  items,
  footer,
  label,
}: {
  brand: ReactNode;
  company?: ReactNode;
  items: NavItem[];
  footer?: ReactNode;
  label: string;
}) {
  return (
    <aside className="flex h-full w-64 flex-col gap-6 border-r border-line bg-surface p-4">
      <div className="px-2">{brand}</div>
      {company}
      <nav aria-label={label}>
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li key={it.href}>
              <a
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={clsx(
                  "focus-ring flex min-h-tap items-center gap-3 rounded-btn px-3 text-body",
                  it.active
                    ? "bg-muted font-semibold text-ink shadow-[inset_3px_0_0_var(--ts-signal)]"
                    : "text-ink-2 hover:bg-surface-2",
                )}
              >
                <span aria-hidden className="[&>svg]:size-5 [&>svg]:stroke-[1.7]">
                  {it.icon}
                </span>
                {it.label}
                {it.badge ? <Badge n={it.badge} /> : null}
              </a>
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
  notificationsLabel: string;
  hasNotifications?: boolean;
  onNotifications: () => void;
}

/** Top bar: crumb, ⌘K search, UA/EN switch, notifications. */
export function TopBar(p: TopBarProps) {
  return (
    <header className="flex h-20 items-center gap-4 border-b border-line bg-bg px-8">
      <span className="flex-1 text-body font-semibold text-ink">{p.crumb}</span>
      <button
        type="button"
        onClick={p.onSearch}
        className="focus-ring flex min-h-tap w-[450px] max-w-full items-center gap-3 rounded-input border border-line bg-surface px-4 text-left text-body text-ink-3"
      >
        <Search aria-hidden className="size-5" strokeWidth={1.7} />
        <span className="flex-1">{p.searchLabel}</span>
        <kbd className="rounded-[6px] border border-line px-1.5 font-mono text-[12px]">⌘K</kbd>
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
      <button
        type="button"
        aria-label={p.notificationsLabel}
        onClick={p.onNotifications}
        className="focus-ring relative inline-flex size-11 items-center justify-center rounded-btn border border-line bg-surface"
      >
        <Bell aria-hidden className="size-5" strokeWidth={1.7} />
        {p.hasNotifications && <span className="absolute top-2.5 right-2.5 size-2 rounded-chip bg-urgent" />}
      </button>
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
