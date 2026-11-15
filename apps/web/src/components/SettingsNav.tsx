import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Sub-navigation of the settings area: Company and Team are Owner-only, Account is for everyone. */
export async function SettingsNav({
  active,
  owner,
}: {
  active: "workspace" | "account" | "team";
  owner: boolean;
}) {
  const t = await getTranslations("App");
  const tabs = [
    ...(owner ? [{ id: "workspace" as const, href: "/settings/workspace", label: t("setWorkspace") }] : []),
    { id: "account" as const, href: "/settings/account", label: t("setAccount") },
    ...(owner ? [{ id: "team" as const, href: "/settings/team", label: t("navTeam") }] : []),
  ];
  return (
    <nav
      aria-label={t("navSettings")}
      className="mb-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-input bg-muted p-1"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={`focus-ring rounded-btn px-3 py-2 text-body font-semibold whitespace-nowrap sm:px-4 ${tab.id === active ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
