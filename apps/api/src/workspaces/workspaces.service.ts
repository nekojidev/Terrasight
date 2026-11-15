import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { hashToken, newOpaqueToken } from "../auth/tokens.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Language, Role, Units } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";

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
  currency?: "USD" | "UAH";
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /** Onboarding step 1 (S-01.02): the creator becomes the Owner. One user = one company (PD v2.12). */
  async create(userId: string, input: WorkspaceInput) {
    const has = await this.prisma.system.membership.count({ where: { userId } });
    if (has > 0) throw new ProblemException(409, "one-company", "Your account already belongs to a company");
    return this.prisma.system.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: input.name.trim(),
          slug: slugify(input.name),
          timeZone: input.timeZone,
          units: input.units,
          reportLanguage: input.reportLanguage,
          ...(input.currency ? { currency: input.currency } : {}),
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
        ...pick(input, ["timeZone", "units", "reportLanguage", "currency"]),
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
    };
  }

  /**
   * Owner creates a user (PD v2.9, v2.12): always a new account with a one-time setup link. One user = one company,
   * so an email that already has an account is refused (409 `email-in-use`), never added or invited.
   */
  async createUser(
    workspaceId: string,
    actor: { id: string; role: Role },
    input: { name: string; email: string; role: Role },
  ): Promise<{ userId: string; setupUrl: string; expiresAt: Date }> {
    if (input.role === "owner" && actor.role !== "owner")
      throw new ProblemException(403, "owner-only", "Only an Owner can create an Owner");
    const email = input.email.trim().toLowerCase();
    const inUse = () => new ProblemException(409, "email-in-use", "This email is already used by another account");
    if (await this.prisma.system.user.findUnique({ where: { email }, select: { id: true } })) throw inUse();
    try {
      return await this.prisma.system.$transaction(async (tx) => {
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
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw inUse(); // lost a race on the unique email
      throw e;
    }
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
      // One user = one company: a removed member has no other membership, so the account goes too
      // (sessions cascade).
      await tx.membership.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
      const others = await tx.membership.count({ where: { userId } });
      if (others === 0) await tx.user.delete({ where: { id: userId } });
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
