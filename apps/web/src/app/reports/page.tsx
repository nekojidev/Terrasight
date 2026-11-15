import { redirect } from "next/navigation";

/** The monthly owner report is gone (PD v2.7): old links and bookmarks land on Owner decisions. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ field?: string }> }) {
  const { field } = await searchParams;
  redirect(field ? `/decisions?field=${encodeURIComponent(field)}` : "/decisions");
}
