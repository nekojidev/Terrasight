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
  /** Marks `oldId` revoked and replaced by `newId`, only if it is still active. Returns false if it wasn't. */
  markReplaced(oldId: string, newId: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
}

export type RotateResult =
  { ok: true; userId: string; token: string } | { ok: false; reason: "unknown" | "expired" | "reused" };

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
   * rotated or revoked means it leaked: the whole family is revoked and the user is signed out everywhere.
   */
  async rotate(token: string | undefined): Promise<RotateResult> {
    if (!token) return { ok: false, reason: "unknown" };
    const row = await this.store.findByHash(hashToken(token));
    if (!row) return { ok: false, reason: "unknown" };
    const now = this.now();
    if (row.revokedAt || row.replacedBy) {
      await this.store.revokeFamily(row.familyId, now);
      return { ok: false, reason: "reused" };
    }
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };

    const next = newOpaqueToken();
    const nextId = randomUUID();
    await this.store.insert({
      id: nextId,
      userId: row.userId,
      familyId: row.familyId,
      tokenHash: hashToken(next),
      expiresAt: new Date(now.getTime() + REFRESH_TTL_S * 1000),
    });
    // Two concurrent refreshes with the same token: only one wins; the loser is treated as reuse.
    if (!(await this.store.markReplaced(row.id, nextId, now))) {
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
