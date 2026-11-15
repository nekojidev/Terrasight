import { PageContainer, Skeleton } from "@terrasight/ui";
import { getTranslations } from "next-intl/server";

/** Root loading state while a server page fetches: skeletons of the final shape (headline number, cards, rows). */
export default async function Loading() {
  const t = await getTranslations("App");
  return (
    <PageContainer className="flex min-h-dvh flex-col gap-4 py-8">
      <Skeleton variant="number" label={t("loading")} />
      <Skeleton variant="card" label={t("loading")} />
      <Skeleton variant="rows" rows={3} label={t("loading")} />
    </PageContainer>
  );
}
