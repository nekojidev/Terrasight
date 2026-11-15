import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service.js";
import type { Language } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Report links (RFC §14.1): the owner opens the decisions without an account. Decisions live in DecisionsService. */
export const REPORT_LINK_DEFAULT_DAYS = 60;
export const REPORT_LINK_MAX_DAYS = 365;

/** Report links always expire: 60 days unless a (future, at most one year away) date is given. */
export function linkExpiry(requested: string | null | undefined, now = Date.now()): Date {
  const max = now + REPORT_LINK_MAX_DAYS * 864e5;
  if (!requested) return new Date(now + REPORT_LINK_DEFAULT_DAYS * 864e5);
  const at = new Date(requested).getTime();
  if (!Number.isFinite(at) || at <= now)
    throw new ProblemException(422, "invalid-input", "The expiry date must be in the future");
  return new Date(Math.min(at, max));
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- report links (RFC §14.1) ----------

  async createLink(
    workspaceId: string,
    userId: string,
    body: { language: Language; expiresAt?: string | null },
  ) {
    const token = randomBytes(32).toString("base64url");
    const link = await this.prisma.system.reportLink.create({
      data: {
        workspaceId,
        tokenHash: hashToken(token),
        language: body.language,
        expiresAt: linkExpiry(body.expiresAt),
      },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "reportLink.create", target: link.id },
    });
    // The token is shown once; only its hash is stored.
    return { id: link.id, token, path: `/r/${token}`, language: link.language, expiresAt: link.expiresAt };
  }

  async links(workspaceId: string) {
    const rows = await this.prisma.system.reportLink.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((l) => ({
      id: l.id,
      language: l.language,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      createdAt: l.createdAt,
    }));
  }

  async revokeLink(workspaceId: string, userId: string, id: string) {
    const r = await this.prisma.system.reportLink.updateMany({
      where: { id, workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) throw new ProblemException(404, "not-found");
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "reportLink.revoke", target: id },
    });
  }

  /** Resolves a report link: valid, not revoked, not expired; else 404 (nothing else is reachable through it). */
  async byToken(token: string) {
    const link = await this.prisma.system.reportLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt < new Date()))
      throw new ProblemException(404, "not-found");
    return link;
  }
}
