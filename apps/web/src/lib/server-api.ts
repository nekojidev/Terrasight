import "server-only";
import { cookies } from "next/headers";

export interface Me {
  id: string;
  email: string;
  name: string;
  uiLanguage: "uk" | "en";
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    timeZone: string;
    units: "metric" | "imperial";
    reportLanguage: "uk" | "en";
    role: "owner" | "admin" | "agronomist" | "viewer";
  }>;
}

export type ServerResult<T> = { ok: true; data: T } | { ok: false; status: number };

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Server-side GET to the API with the user's cookies. Server components can't refresh the session. */
export async function serverGet<T>(path: string): Promise<ServerResult<T>> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: { cookie }, cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

/** The active workspace: the `ts_ws` cookie if the user is a member, otherwise the first one. */
export async function activeWorkspace(me: Me): Promise<Me["workspaces"][number] | null> {
  const wanted = (await cookies()).get("ts_ws")?.value;
  return me.workspaces.find((w) => w.id === wanted) ?? me.workspaces[0] ?? null;
}
