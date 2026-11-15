import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { hashToken, newOpaqueToken } from "../auth/tokens.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Language, Role, Units } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";

export const INVITE_TTL_DAYS = 7;
export const SETUP_TTL_DAYS = 7;

/** True for a valid IANA time zone name ("America/Chicago"). */
export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  // DateTimeFormat throws RangeError for unknown zones and accepts current names (Europe/Kyiv) that
  // Intl.supportedValuesOf may list under an older canonical name (Europe/Kiev).
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "company"}-${randomBytes(3).toString("hex")}`;
}

export interface WorkspaceInput {
  name: string;
  timeZone: string;
  units: Units;
  reportLanguage: Language;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Onboarding step 1 (S-01.02): the creator becomes the Owner. */
  async create(userId: string, input: WorkspaceInput) {
    return this.prisma.system.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          slug: slugify(input.name),
          timeZone: input.timeZone,
          units: input.units,
          reportLanguage: input.reportLanguage,
        },
      });
      await tx.membership.create({ data: { workspaceId: ws.id, userId, role: "owner" } });
      await tx.auditLog.create({ data: { workspaceId: ws.id, userId, action: "workspace.create" } });
      return { ...ws, role: "owner" as Role };
    });
  }

  async get(workspaceId: string) {
    const ws = await this.prisma.system.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new ProblemException(404, "not-found");
    const fieldCount = await this.prisma.db.field.count({ where: { workspaceId, archivedAt: null } });
    return { ...ws, fieldCount };
  }

  async update(workspaceId: string, userId: string, input: Partial<WorkspaceInput>) {
    const ws = await this.prisma.system.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...pick(input, ["timeZone", "units", "reportLanguage"]),
      },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId, action: "workspace.update", target: Object.keys(input).join(",") },
    });
    return ws;
  }

  // ---------- members (S-01.04) ----------

  async members(workspaceId: string) {
    const rows = await this.prisma.system.membership.findMany({
      where: { workspaceId },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, passwordHash: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const invites = await this.prisma.system.invitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    return {
      members: rows.map((r) => ({
        id: r.user.id,
        name: r.user.name,
        email: r.user.email,
        role: r.role,
        since: r.createdAt,
        // true until the user sets a password from the setup link (Copy link / New link in the UI).
        needsSetup: r.user.passwordHash === null,
      })),
      pendingInvitations: invites,
    };
  }

  /** Owner creates a user (PD v2.9): a new account gets a one-time setup link; an existing one is just added. */
  async createUser(
    workspaceId: string,
    actor: { id: string; role: Role },
    input: { name: string; email: string; role: Role },
  ): Promise<{ userId: string; setupUrl: string; expiresAt: Date } | { userId: string; existing: true }> {
    if (input.role === "owner" && actor.role !== "owner")
      throw new ProblemException(403, "owner-only", "Only an Owner can create an Owner");
    const email = input.email.trim().toLowerCase();
    return this.prisma.system.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        const member = await tx.membership.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: existing.id } },
        });
        if (member) throw new ProblemException(409, "already-member", "This person is already a member");
        await tx.membership.create({ data: { workspaceId, userId: existing.id, role: input.role } });
        await tx.auditLog.create({
          data: {
            workspaceId,
            userId: actor.id,
            action: "member.add",
            target: `${existing.id}:${input.role}`,
          },
        });
        return { userId: existing.id, existing: true as const };
      }
      const token = newOpaqueToken();
      const expiresAt = new Date(Date.now() + SETUP_TTL_DAYS * 864e5);
      const user = await tx.user.create({
        data: { email, name: input.name.trim(), setupTokenHash: hashToken(token), setupExpiresAt: expiresAt },
        select: { id: true },
      });
      await tx.membership.create({ data: { workspaceId, userId: user.id, role: input.role } });
      await tx.auditLog.create({
        data: { workspaceId, userId: actor.id, action: "member.create", target: `${user.id}:${input.role}` },
      });
      return { userId: user.id, setupUrl: `/setup/${token}`, expiresAt };
    });
  }

  /** A fresh setup link for a member who hasn't set a password yet; the old link stops working. */
  async newSetupLink(workspaceId: string, actor: { id: string; role: Role }, userId: string) {
    const target = await this.prisma.system.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, user: { select: { passwordHash: true } } },
    });
    if (!target) throw new ProblemException(404, "not-found");
    if (target.role === "owner" && actor.role !== "owner")
      throw new ProblemException(403, "owner-only", "Only an Owner can reset an Owner's link");
    if (target.user.passwordHash !== null)
      throw new ProblemException(409, "password-set", "This user has already set a password");
    const token = newOpaqueToken();
    const expiresAt = new Date(Date.now() + SETUP_TTL_DAYS * 864e5);
    await this.prisma.system.user.update({
      where: { id: userId },
      data: { setupTokenHash: hashToken(token), setupExpiresAt: expiresAt },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId: actor.id, action: "member.setup-link", target: userId },
    });
    return { userId, setupUrl: `/setup/${token}`, expiresAt };
  }

  /** Creates a single-use invitation. Email sending is optional in the hackathon: the link is returned to copy. */
  async invite(workspaceId: string, actor: { id: string; role: Role }, email: string, role: Role) {
    if (role === "owner" && actor.role !== "owner")
      throw new ProblemException(403, "owner-only", "Only an Owner can invite an Owner");
    const already = await this.prisma.system.membership.findFirst({
      where: { workspaceId, user: { email } },
      select: { userId: true },
    });
    if (already) throw new ProblemException(409, "already-member", "This person is already a member");
    const token = newOpaqueToken();
    const invitation = await this.prisma.system.invitation.create({
      data: {
        workspaceId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    await this.prisma.db.auditLog.create({
      data: { workspaceId, userId: actor.id, action: "member.invite", target: `${email}:${role}` },
    });
    return { ...invitation, token };
  }

  async invitationInfo(token: string) {
    const inv = await this.prisma.system.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        workspace: { select: { name: true } },
      },
    });
    if (!inv) throw new ProblemException(404, "invitation-not-found");
    return {
      workspaceName: inv.workspace.name,
      email: inv.email,
      role: inv.role,
      status: inv.acceptedAt ? "accepted" : inv.expiresAt <= new Date() ? "expired" : "open",
    };
  }

  /** The invited email must be the signed-in user's email, so a forwarded link can't be used by someone else. */
  async accept(token: string, userId: string) {
    return this.prisma.system.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!inv) throw new ProblemException(404, "invitation-not-found");
      if (inv.acceptedAt)
        throw new ProblemException(410, "invitation-used", "This invitation was already used");
      if (inv.expiresAt <= new Date())
        throw new ProblemException(410, "invitation-expired", "This invitation has expired");
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) {
        throw new ProblemException(403, "invitation-other-email", `This invitation is for ${inv.email}`);
      }
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ProblemException(410, "invitation-used");
      await tx.membership.upsert({
        where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
        create: { workspaceId: inv.workspaceId, userId, role: inv.role },
        update: {},
      });
      await tx.auditLog.create({
        data: { workspaceId: inv.workspaceId, userId, action: "member.join", target: inv.role },
      });
      return { workspaceId: inv.workspaceId, role: inv.role };
    });
  }

  async setRole(workspaceId: string, actor: { id: string; role: Role }, userId: string, role: Role) {
    return this.prisma.system.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!target) throw new ProblemException(404, "not-found");
      if ((role === "owner" || target.role === "owner") && actor.role !== "owner") {
        throw new ProblemException(403, "owner-only", "Only an Owner can grant or remove the Owner role");
      }
      if (target.role === "owner" && role !== "owner") await assertNotLastOwner(tx, workspaceId);
      await tx.membership.update({ where: { workspaceId_userId: { workspaceId, userId } }, data: { role } });
      await tx.auditLog.create({
        data: { workspaceId, userId: actor.id, action: "member.role", target: `${userId}:${role}` },
      });
      return { userId, role };
    });
  }

  async remove(workspaceId: string, actor: { id: string; role: Role }, userId: string) {
    await this.prisma.system.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!target) throw new ProblemException(404, "not-found");
      if (target.role === "owner") {
        if (actor.role !== "owner") throw new ProblemException(403, "owner-only");
        await assertNotLastOwner(tx, workspaceId);
      }
      await tx.membership.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
      await tx.auditLog.create({
        data: { workspaceId, userId: actor.id, action: "member.remove", target: userId },
      });
    });
  }
}

type Tx = Parameters<Parameters<PrismaService["system"]["$transaction"]>[0]>[0];

async function assertNotLastOwner(tx: Tx, workspaceId: string): Promise<void> {
  const owners = await tx.membership.count({ where: { workspaceId, role: "owner" } });
  if (owners <= 1) throw new ProblemException(409, "last-owner", "A workspace needs at least one Owner");
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
