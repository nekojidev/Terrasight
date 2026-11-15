import { Skeleton } from "@terrasight/ui";
import { getTranslations } from "next-intl/server";

/** Root loading state while a server page fetches: the same skeleton as the cards, so nothing jumps. */
export default async function Loading() {
  const t = await getTranslations("App");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col gap-4 px-4 py-8 sm:px-8">
      <Skeleton label={t("loading")} />
      <Skeleton label={t("loading")} />
    </main>
  );
}
