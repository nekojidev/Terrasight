import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { hashToken, newOpaqueToken } from "../auth/tokens.js";
import { PrismaService } from "../db/prisma.service.js";
import type { Language, Role, Units } from "../generated/prisma/enums.js";
import { ProblemException } from "../http/problem.js";

export const INVITE_TTL_DAYS = 7;
export const DEMO_TEMPLATE_SLUG = "demo-template";

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
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    const invites = await this.prisma.system.invitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
    return {
      members: rows.map((r) => ({ ...r.user, role: r.role, since: r.createdAt })),
      pendingInvitations: invites,
    };
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

  // ---------- demo company (S-01.06) ----------

  /**
   * Copies the seeded template (Prairie Field Co., S-09.03) into a new workspace marked as demo, with the user
   * as Owner. Fields, crop history, season records, field history and plans are copied in SQL; the source
   * cache is shared, so the copy is cheap.
   */
  async demoCopy(userId: string) {
    const template = await this.prisma.system.workspace.findUnique({ where: { slug: DEMO_TEMPLATE_SLUG } });
    if (!template)
      throw new ProblemException(404, "demo-not-seeded", "The demo company is not available yet");
    return this.prisma.system.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: template.name,
          slug: slugify(template.name),
          timeZone: template.timeZone,
          units: template.units,
          reportLanguage: template.reportLanguage,
          currency: template.currency,
          isDemo: true,
          demoTemplateId: template.id,
        },
      });
      await tx.membership.create({ data: { workspaceId: ws.id, userId, role: "owner" } });
      await tx.$executeRaw`
        CREATE TEMP TABLE field_map ON COMMIT DROP AS
        SELECT id AS old_id, gen_random_uuid() AS new_id FROM fields WHERE workspace_id = ${template.id}::uuid AND archived_at IS NULL`;
      await tx.$executeRaw`
        INSERT INTO fields (id, workspace_id, name, alias_no, geom, centroid, area_ha, admin_code, country, county_name,
                            region_id, tier, irrigation, irrigation_source, slope_pct, thumbnail_key, created_by)
        SELECT m.new_id, ${ws.id}::uuid, f.name, f.alias_no, f.geom, f.centroid, f.area_ha, f.admin_code, f.country,
               f.county_name, f.region_id, f.tier, f.irrigation, f.irrigation_source, f.slope_pct, f.thumbnail_key, ${userId}::uuid
        FROM fields f JOIN field_map m ON m.old_id = f.id`;
      await tx.$executeRaw`
        INSERT INTO crop_seasons (field_id, season, main_crop, second_crop, confidence, source, is_override, updated_at)
        SELECT m.new_id, c.season, c.main_crop, c.second_crop, c.confidence, c.source, c.is_override, now()
        FROM crop_seasons c JOIN field_map m ON m.old_id = c.field_id`;
      await tx.$executeRaw`
        INSERT INTO season_records (field_id, season, crop, crop_source, sowing_date, sowing_source, emergence_date,
                                    emergence_source, irrigated, tillage, updated_at)
        SELECT m.new_id, s.season, s.crop, s.crop_source, s.sowing_date, s.sowing_source, s.emergence_date,
               s.emergence_source, s.irrigated, s.tillage, now()
        FROM season_records s JOIN field_map m ON m.old_id = s.field_id`;
      await tx.$executeRaw`
        INSERT INTO field_history (field_id, built_at, inputs_hash, provisional, bare_months, stress_years, ndvi_peaks,
                                   irrigation_detection, baseline_match)
        SELECT m.new_id, h.built_at, h.inputs_hash, h.provisional, h.bare_months, h.stress_years, h.ndvi_peaks,
               h.irrigation_detection, h.baseline_match
        FROM field_history h JOIN field_map m ON m.old_id = h.field_id`;
      await tx.$executeRaw`
        INSERT INTO plans (field_id, season, crop, rotation_id, saved_by, saved_at)
        SELECT m.new_id, p.season, p.crop, p.rotation_id, ${userId}::uuid, now()
        FROM plans p JOIN field_map m ON m.old_id = p.field_id`;
      // The brief, the report and the owner's open question come along, so the demo tells its story at once.
      await tx.$executeRaw`
        CREATE TEMP TABLE rec_map ON COMMIT DROP AS
        SELECT r.id AS old_id, gen_random_uuid() AS new_id FROM recommendations r JOIN field_map m ON m.old_id = r.field_id
        WHERE r.status IN ('open', 'accepted', 'snoozed', 'in_report')`;
      await tx.$executeRaw`
        INSERT INTO recommendations (id, workspace_id, field_id, type, subject, season, status, level, confidence, tier, deadline,
                                     irreversible, planning, key_numbers, drivers, evidence, unknowns, model_ref, versions,
                                     input_snapshot_id, text_override, committed_at, updated_at)
        SELECT rm.new_id, ${ws.id}::uuid, fm.new_id, r.type, r.subject, r.season,
               CASE WHEN r.status = 'in_report' THEN 'in_report'::"RecStatus" ELSE 'open'::"RecStatus" END,
               r.level, r.confidence, r.tier, r.deadline, r.irreversible, r.planning, r.key_numbers, r.drivers, r.evidence,
               r.unknowns, r.model_ref, r.versions, r.input_snapshot_id, r.text_override, r.committed_at, now()
        FROM recommendations r JOIN rec_map rm ON rm.old_id = r.id JOIN field_map fm ON fm.old_id = r.field_id`;
      await tx.$executeRaw`
        CREATE TEMP TABLE item_map ON COMMIT DROP AS
        SELECT i.id AS old_id, gen_random_uuid() AS new_id FROM report_items i JOIN rec_map rm ON rm.old_id = i.recommendation_id
        WHERE i.superseded_by IS NULL`;
      await tx.$executeRaw`
        INSERT INTO report_items (id, workspace_id, recommendation_id, text, note, committed_at)
        SELECT im.new_id, ${ws.id}::uuid, rm.new_id, i.text, i.note, i.committed_at
        FROM report_items i JOIN item_map im ON im.old_id = i.id JOIN rec_map rm ON rm.old_id = i.recommendation_id`;
      await tx.$executeRaw`
        INSERT INTO owner_answers (id, report_item_id, answer, text, via, user_id, created_at)
        SELECT gen_random_uuid(), im.new_id, a.answer, a.text, a.via, NULL, a.created_at
        FROM owner_answers a JOIN item_map im ON im.old_id = a.report_item_id`;
      await tx.auditLog.create({
        data: { workspaceId: ws.id, userId, action: "workspace.demo-copy", target: template.id },
      });
      return { ...ws, role: "owner" as Role };
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
