import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Sub-navigation of the settings area: Company and Team are Owner-only, Account is for everyone. */
export async function SettingsNav({
  active,
  owner,
}: {
  active: "workspace" | "account" | "team" | "prices";
  owner: boolean;
}) {
  const t = await getTranslations("App");
  const tabs = [
    { id: "account" as const, href: "/settings/account", label: t("setAccount") },
    ...(owner ? [{ id: "workspace" as const, href: "/settings/workspace", label: t("setWorkspace") }] : []),
    ...(owner ? [{ id: "team" as const, href: "/settings/team", label: t("navTeam") }] : []),
    { id: "prices" as const, href: "/settings/prices", label: t("setPrices") },
  ];
  return (
    <nav
      aria-label={t("navSettings")}
      className="mb-6 grid w-full grid-cols-2 gap-1 rounded-input bg-muted p-1 sm:flex sm:w-fit sm:max-w-full"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={`focus-ring inline-flex min-h-tap items-center justify-center rounded-btn px-3 text-center text-body font-semibold sm:px-4 sm:whitespace-nowrap ${tab.id === active ? "bg-ink text-surface" : "text-ink hover:bg-surface"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
