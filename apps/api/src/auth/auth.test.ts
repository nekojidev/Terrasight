import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { isTimeZone, slugify } from "../workspaces/workspaces.service.js";
import { requireRequestedWith } from "../http/csrf.js";
import { can, PERMISSIONS, type Permission } from "./permissions.js";
import { MemoryBuckets } from "./rate-limit.js";
import { RefreshTokens, type RefreshRow, type RefreshStore } from "./refresh.js";
import { hashToken, signAccess, verifyAccess } from "./tokens.js";

const SECRET = "s".repeat(32);

class MemoryStore implements RefreshStore {
  rows = new Map<string, RefreshRow>();
  async insert(row: Omit<RefreshRow, "revokedAt" | "replacedBy">) {
    this.rows.set(row.id, { ...row, revokedAt: null, replacedBy: null });
  }
  async findByHash(hash: string) {
    return [...this.rows.values()].find((r) => r.tokenHash === hash) ?? null;
  }
  async markReplaced(oldId: string, newId: string, at: Date) {
    const r = this.rows.get(oldId);
    if (!r || r.revokedAt || r.replacedBy) return false;
    r.revokedAt = at;
    r.replacedBy = newId;
    return true;
  }
  async revokeFamily(familyId: string, at: Date) {
    for (const r of this.rows.values()) if (r.familyId === familyId && !r.revokedAt) r.revokedAt = at;
  }
  async revoke(id: string, at: Date) {
    const r = this.rows.get(id);
    if (r && !r.revokedAt) r.revokedAt = at;
  }
}

describe("access tokens", () => {
  it("round-trips the user id", async () => {
    expect(await verifyAccess(await signAccess("u1", SECRET), SECRET)).toBe("u1");
  });
  it("rejects a token signed with another key, an expired token and garbage", async () => {
    expect(await verifyAccess(await signAccess("u1", "x".repeat(32)), SECRET)).toBeNull();
    const old = await signAccess("u1", SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyAccess(old, SECRET)).toBeNull();
    expect(await verifyAccess("not.a.jwt", SECRET)).toBeNull();
    expect(await verifyAccess(undefined, SECRET)).toBeNull();
  });
});

describe("refresh token rotation (Tech Design §14.1)", () => {
  it("stores only hashes and rotates within the family", async () => {
    const store = new MemoryStore();
    const tokens = new RefreshTokens(store);
    const t1 = await tokens.issue("u1");
    expect([...store.rows.values()][0]!.tokenHash).toBe(hashToken(t1));
    const r = await tokens.rotate(t1);
    expect(r).toMatchObject({ ok: true, userId: "u1" });
    const families = new Set([...store.rows.values()].map((x) => x.familyId));
    expect(families.size).toBe(1);
  });

  it("revokes the whole family when a rotated token is reused", async () => {
    const store = new MemoryStore();
    const tokens = new RefreshTokens(store);
    const t1 = await tokens.issue("u1");
    const r1 = await tokens.rotate(t1);
    expect(r1.ok).toBe(true);
    expect(await tokens.rotate(t1)).toEqual({ ok: false, reason: "reused" });
    // The legitimate newer token is now dead too: the user is signed out everywhere.
    expect(await tokens.rotate(r1.ok ? r1.token : "")).toEqual({ ok: false, reason: "reused" });
  });

  it("treats two concurrent refreshes with one token as reuse", async () => {
    const store = new MemoryStore();
    const tokens = new RefreshTokens(store);
    const t1 = await tokens.issue("u1");
    const results = await Promise.all([tokens.rotate(t1), tokens.rotate(t1)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect([...store.rows.values()].every((r) => r.revokedAt)).toBe(true);
  });

  it("rejects expired and unknown tokens", async () => {
    const store = new MemoryStore();
    let now = new Date("2026-11-14T00:00:00Z");
    const tokens = new RefreshTokens(store, () => now);
    const t1 = await tokens.issue("u1");
    now = new Date("2026-12-31T00:00:00Z");
    expect(await tokens.rotate(t1)).toEqual({ ok: false, reason: "expired" });
    expect(await tokens.rotate("nope")).toEqual({ ok: false, reason: "unknown" });
  });

  it("logout revokes the family", async () => {
    const store = new MemoryStore();
    const tokens = new RefreshTokens(store);
    const t1 = await tokens.issue("u1");
    await tokens.revoke(t1);
    expect((await tokens.rotate(t1)).ok).toBe(false);
  });
});

describe("permission matrix (Tech Design §14.1)", () => {
  const roles = ["owner", "admin", "agronomist", "viewer"] as const;
  const expected: Record<Permission, string> = {
    "workspace.delete": "O...",
    billing: "O...",
    "workspace.settings": "OA..",
    "members.manage": "OA..",
    "reportLinks.manage": "OA..",
    "fields.write": "OAG.",
    "analysis.run": "OAG.",
    "recommendations.act": "OAG.",
    "outcomes.record": "OAG.",
    "scouting.use": "OAG.",
    "assistant.use": "OAG.",
    "plans.save": "OAG.",
    "brief.read": "OAG.",
    "fields.read": "OAG.",
    "scenarios.explore": "OAGV",
    "report.read": "OAGV",
    "report.answer": "OAGV",
    "workspace.read": "OAGV",
  };

  it("covers every permission", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))("%s → %s", (permission, mask) => {
    const got = roles.map((r, i) => (can(r, permission as Permission) ? "OAGV"[i] : ".")).join("");
    expect(got).toBe(mask);
  });
});

describe("rate limiting without Redis (RFC §5.2)", () => {
  it("runs the local bucket at half rate and refills over time", () => {
    let t = 0;
    const b = new MemoryBuckets(() => t);
    const spec = { capacity: 10, refillPerSec: 1 };
    const allowed = Array.from({ length: 8 }, () => b.take("k", spec)).filter(Boolean).length;
    expect(allowed).toBe(5);
    t += 2_000; // half rate: 0.5 token/s → 1 token
    expect(b.take("k", spec)).toBe(true);
    expect(b.take("k", spec)).toBe(false);
  });
});

describe("CSRF header (Tech Design §14.1)", () => {
  const run = (method: string, path: string, header?: string) => {
    const next = vi.fn() as unknown as NextFunction;
    const json = vi.fn();
    const res = { status: vi.fn(() => res), type: vi.fn(() => res), json } as unknown as Response;
    const req = { method, path, get: () => header } as unknown as Request;
    requireRequestedWith(req, res, next);
    return { next: next as unknown as ReturnType<typeof vi.fn>, json };
  };
  it("rejects mutating API requests without X-Requested-With", () => {
    expect(run("POST", "/api/auth/login").json).toHaveBeenCalled();
    expect(run("DELETE", "/api/w/x/members/y").next).not.toHaveBeenCalled();
  });
  it("lets safe methods, health checks and requests with the header through", () => {
    expect(run("GET", "/api/me").next).toHaveBeenCalled();
    expect(run("POST", "/api/auth/login", "XMLHttpRequest").next).toHaveBeenCalled();
    expect(run("POST", "/healthz").next).toHaveBeenCalled();
  });
});

describe("workspace input helpers", () => {
  it("accepts IANA time zones only", () => {
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("Europe/Kyiv")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
  it("makes URL-safe unique slugs, also from Cyrillic names", () => {
    expect(slugify("Prairie Field Co.")).toMatch(/^prairie-field-co-[0-9a-f]{6}$/);
    expect(slugify("Агро Степ")).toMatch(/^company-[0-9a-f]{6}$|^[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(slugify("x")).not.toBe(slugify("x"));
  });
});
