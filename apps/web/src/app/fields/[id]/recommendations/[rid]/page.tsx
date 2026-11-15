import { RecommendationPageBody } from "../../../../recommendations/[id]/RecommendationPageBody";

/** Design 09: /fields/:id/recommendations/:rid. */
export default async function FieldRecommendationPage({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { rid } = await params;
  return <RecommendationPageBody id={rid} canonical />;
}
