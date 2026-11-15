"use client";

import { Button, Surface } from "@terrasight/ui";
import { Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Design 03 (S-01.05): first run with no fields. One clear action and one sentence about what happens next.
 * The Agronomist adds the first field; the Owner is pointed to adding the agronomist (Team in Settings).
 */
export function EmptyHome({ firstName, isOwner = false }: { firstName: string; isOwner?: boolean }) {
  const t = useTranslations("EmptyHome");
  const a = useTranslations("App");
  const router = useRouter();

  if (isOwner) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-h1 text-ink">{t("owner_hello", { name: firstName })}</h1>
          <p className="mt-3 max-w-[66ch] text-body text-ink-2">{t("owner_sub")}</p>
        </div>
        <Surface tone="hero" pad="lg" className="animate-rise flex max-w-xl flex-col gap-3">
          <h2 className="text-h2 text-ink">{t("owner_title")}</h2>
          <p className="text-body text-ink-2">{t("owner_body")}</p>
          <Button size={56} icon={<Users />} onClick={() => router.push("/settings/team")} className="max-sm:w-full">
            {t("owner_cta")}
          </Button>
        </Surface>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-h1 text-ink">{a("helloName", { name: firstName })}</h1>
        <p className="mt-3 max-w-[66ch] text-body text-ink-2">{t("sub")}</p>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <Button size={56} icon={<Plus />} onClick={() => router.push("/fields/new")} className="max-sm:w-full">
            {t("add")}
          </Button>
        </div>
        <p className="text-small text-ink-2">{t("what_next")}</p>
      </div>
    </div>
  );
}
