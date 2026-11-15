import { randomUUID } from "node:crypto";
import { hashToken, newOpaqueToken, REFRESH_TTL_S } from "./tokens.js";

export interface RefreshRow {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

/** Persistence for refresh tokens; PostgreSQL in the app, in-memory in unit tests. */
export interface RefreshStore {
  insert(row: Omit<RefreshRow, "revokedAt" | "replacedBy">): Promise<void>;
  findByHash(hash: string): Promise<RefreshRow | null>;
  findById(id: string): Promise<RefreshRow | null>;
  /** Marks `oldId` revoked and replaced by `newId`, only if it is still active. Returns false if it wasn't. */
  markReplaced(oldId: string, newId: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
}

export type RotateResult =
  { ok: true; userId: string; token: string } | { ok: false; reason: "unknown" | "expired" | "reused" };

/** Two tabs refreshing at once present the same token; the loser within this window is not treated as theft. */
export const REFRESH_GRACE_MS = 20_000;

/** Refresh token rotation with family revocation (Tech Design §14.1). */
export class RefreshTokens {
  constructor(
    private readonly store: RefreshStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Starts a new family at sign-in. */
  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const token = newOpaqueToken();
    await this.store.insert({
      id: randomUUID(),
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(this.now().getTime() + REFRESH_TTL_S * 1000),
    });
    return token;
  }

  /**
   * Exchanges a refresh token for a new one in the same family. Presenting a token that was already
   * rotated or revoked means it leaked: the whole family is revoked and the user is signed out everywhere,
   * except for a rotated token re-presented within REFRESH_GRACE_MS while its successor is still unused.
   */
  async rotate(token: string | undefined): Promise<RotateResult> {
    if (!token) return { ok: false, reason: "unknown" };
    const row = await this.store.findByHash(hashToken(token));
    if (!row) return { ok: false, reason: "unknown" };
    const now = this.now();
    if (row.revokedAt || row.replacedBy) {
      if (await this.withinGrace(row, now)) return this.mint(row, now, false);
      await this.store.revokeFamily(row.familyId, now);
      return { ok: false, reason: "reused" };
    }
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };
    return this.mint(row, now, true);
  }

  /**
   * A rotated token may be presented again for REFRESH_GRACE_MS (concurrent refresh), but only while its successor
   * is still unused and the family is intact. A later presentation, or one after the successor was rotated or the
   * family revoked, is reuse. Grace answers are siblings: the successor stays valid, the old token is never revived.
   */
  private async withinGrace(row: RefreshRow, now: Date): Promise<boolean> {
    if (!row.replacedBy || !row.revokedAt) return false;
    if (now.getTime() - row.revokedAt.getTime() > REFRESH_GRACE_MS || row.expiresAt <= now) return false;
    const successor = await this.store.findById(row.replacedBy);
    return !!successor && !successor.revokedAt && !successor.replacedBy && successor.expiresAt > now;
  }

  private async mint(row: RefreshRow, now: Date, replace: boolean): Promise<RotateResult> {
    const next = newOpaqueToken();
    const nextId = randomUUID();
    await this.store.insert({
      id: nextId,
      userId: row.userId,
      familyId: row.familyId,
      tokenHash: hashToken(next),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_S * 1000),
    });
    // Two concurrent refreshes with the same active token: only one wins the swap; the loser is a grace case
    // if the winner has just rotated the row, otherwise it is reuse.
    if (replace && !(await this.store.markReplaced(row.id, nextId, now))) {
      const fresh = await this.store.findById(row.id);
      if (fresh && (await this.withinGrace(fresh, now))) return { ok: true, userId: row.userId, token: next };
      await this.store.revokeFamily(row.familyId, now);
      return { ok: false, reason: "reused" };
    }
    return { ok: true, userId: row.userId, token: next };
  }

  /** Sign-out: revokes the presented token's family. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    const row = await this.store.findByHash(hashToken(token));
    if (row) await this.store.revokeFamily(row.familyId, this.now());
  }
}
