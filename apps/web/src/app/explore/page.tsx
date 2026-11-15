import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExploreClient, type OutlineItem } from "./ExploreClient";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Explore");
  return { title: `Terrasight · ${t("title")}`, description: t("tag") };
}

/** The ready outlines. Plain fetch without the visitor's cookies; the climate call itself is made by the browser. */
async function readyOutlines(): Promise<OutlineItem[] | "off"> {
  try {
    const res = await fetch(`${API_URL}/api/public/outlines`, { cache: "no-store" });
    if (res.status === 404) return "off"; // PUBLIC_EXPLORE=0
    if (!res.ok) return [];
    return ((await res.json()) as { items: OutlineItem[] }).items;
  } catch {
    return [];
  }
}

/** Design 20: the public page. No sign-in, no app chrome; the locale comes from the visitor's cookie. */
export default async function ExplorePage() {
  const outlines = await readyOutlines();
  if (outlines === "off") notFound();
  return <ExploreClient outlines={outlines} />;
}
