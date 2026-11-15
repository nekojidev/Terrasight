"use client";

import { clsx } from "clsx";
import { Bell, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { trapTab } from "./focus";

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
    <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-chip bg-urgent px-1.5 text-caption font-semibold text-surface">
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
  bottomItems,
  footer,
  label,
  collapsed = false,
  onToggle,
  toggleLabel,
}: {
  brand: ReactNode;
  company?: ReactNode;
  items: NavItem[];
  /** Items pinned to the bottom of the list (Settings). */
  bottomItems?: NavItem[];
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
      <nav aria-label={label} className="flex min-h-0 flex-1 flex-col justify-between gap-6">
        {[items, bottomItems ?? []].map((list, n) =>
          list.length === 0 ? null : (
            <ul key={n} className="flex flex-col gap-1">
              {list.map((it) => (
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
          ),
        )}
      </nav>
      {footer && <div className="border-t border-line pt-4">{footer}</div>}
    </aside>
  );
}

export interface TopBarProps {
  crumb: string;
  /** Placeholder-style text of the search control ("Search fields or ask the assistant…"). */
  searchLabel: string;
  /** Shortcut shown in the control ("⌘K" or "Ctrl K"). */
  searchHint?: string;
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
    <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b border-line bg-bg px-4 sm:gap-4 sm:px-8">
      <span className="flex-1 text-body font-semibold text-ink">{p.crumb}</span>
      <button
        type="button"
        onClick={p.onSearch}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        className="focus-ring flex min-h-tap w-auto max-w-full items-center gap-3 rounded-input border border-line bg-surface px-3 text-left text-body text-ink-3 hover:border-line-strong sm:w-[450px] sm:px-4"
      >
        <Search aria-hidden className="size-5 shrink-0 text-ink-2" strokeWidth={1.7} />
        <span className="sr-only sm:not-sr-only sm:flex-1 sm:truncate">{p.searchLabel}</span>
        {p.searchHint && (
          <kbd
            aria-hidden
            className="hidden rounded-[6px] border border-line bg-surface-2 px-1.5 font-mono text-micro text-ink-2 sm:inline"
          >
            {p.searchHint}
          </kbd>
        )}
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

/** One row of the More sheet: a link, or a button when `onSelect` is given. At least 48 px tall, icon first. */
export function SheetRow({
  href,
  label,
  icon,
  active,
  onSelect,
  trailing,
}: {
  href?: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onSelect?: () => void;
  /** Right-aligned text (the current theme or language). */
  trailing?: string;
}) {
  const cls = clsx(
    "focus-ring flex min-h-12 w-full items-center gap-3 rounded-btn px-3 text-left text-body hover:bg-muted",
    active ? "font-semibold text-ink" : "text-ink",
  );
  const inner = (
    <>
      <span aria-hidden className="inline-flex shrink-0 [&>svg]:size-5 [&>svg]:stroke-[1.7]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {trailing && <span className="text-caption text-ink-2">{trailing}</span>}
    </>
  );
  return href ? (
    <a href={href} aria-current={active ? "page" : undefined} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onSelect} className={cls}>
      {inner}
    </button>
  );
}

export interface MoreTab {
  label: string;
  title: string;
  closeLabel: string;
  /** The tab shows as current when the page lives under More (Plan, Settings). */
  active?: boolean;
  /** Sheet content: SheetRow elements and controls. A tap on a link or an element with data-sheet-close closes it. */
  children: ReactNode;
}

function MoreSheet({ title, closeLabel, onClose, children }: Omit<MoreTab, "label" | "active"> & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else trapTab(e, ref.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label={closeLabel} className="animate-fade absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,[data-sheet-close]")) onClose();
        }}
        className="animate-sheet-in relative max-h-[85dvh] w-full max-w-[480px] overflow-y-auto rounded-t-sheet bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-sheet outline-none"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-chip bg-line-strong" />
        <h2 className="text-h2 mb-2 px-3 text-ink">{title}</h2>
        <div className="flex flex-col gap-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phone navigation: a bar `var(--ts-tabbar)` tall plus the safe-area inset. `more` adds a last tab that opens a
 * sheet; the main column pads its bottom with the same variable (`pb-[calc(var(--ts-tabbar)+env(...))]`).
 */
export function BottomTabs({ items, label, more }: { items: NavItem[]; label: string; more?: MoreTab }) {
  const [open, setOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    moreBtn.current?.focus();
  };
  const tab =
    "focus-ring relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-caption";
  return (
    <>
      <nav
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="flex h-[var(--ts-tabbar)]">
          {items.map((it) => (
            <li key={it.href} className="flex-1">
              <a
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={clsx(tab, it.active ? "font-semibold text-ink" : "text-ink-2")}
              >
                <span aria-hidden className="relative [&>svg]:size-5 [&>svg]:stroke-[1.7]">
                  {it.icon}
                  {it.badge ? (
                    <span className="absolute -top-1 -right-2 size-2.5 rounded-chip bg-urgent" />
                  ) : null}
                </span>
                {it.label}
                {it.badge ? <span className="sr-only">{it.badge}</span> : null}
              </a>
            </li>
          ))}
          {more && (
            <li className="flex-1">
              <button
                ref={moreBtn}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className={clsx(tab, more.active ? "font-semibold text-ink" : "text-ink-2")}
              >
                <span aria-hidden className="[&>svg]:size-5 [&>svg]:stroke-[1.7]">
                  <MoreHorizontal />
                </span>
                {more.label}
              </button>
            </li>
          )}
        </ul>
      </nav>
      {more && open && (
        <MoreSheet title={more.title} closeLabel={more.closeLabel} onClose={close}>
          {more.children}
        </MoreSheet>
      )}
    </>
  );
}
