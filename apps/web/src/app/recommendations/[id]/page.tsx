import { RecommendationPageBody } from "./RecommendationPageBody";

/** Legacy route: redirects to /fields/:id/recommendations/:rid. */
export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecommendationPageBody id={id} canonical={false} />;
}
