import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { frostAlert, stableStringify, waterStress, type AlertResult, type Level } from "@terrasight/evaluators";
import type { Library } from "@terrasight/library";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { RecStatus } from "../generated/prisma/enums.js";
import { LIBRARY } from "../library/library.module.js";
import type { BuiltInputs } from "./eval-inputs.service.js";

const LIVE: RecStatus[] = ["open", "accepted", "snoozed", "in_report", "dismissed"];
const ORDER: Record<Level, number> = { unknown: -1, none: 0, low: 1, moderate: 2, high: 3 };
/** Weather kept in a stored snapshot (same window as the pest items). */
const SNAPSHOT_WEATHER_DAYS = 430;
const MODEL_VERSION = "alerts@1";

/**
 * Weather and irrigation items of a field check (L-13): `frost_alert` and `water_stress`. One live item per field,
 * type, subject and season; an item that no longer applies (no frost in the forecast, no stress in 7 days) is
 * superseded while it is still open or snoozed.
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {}

  /** Runs both evaluators and stores their items; returns how many new items needed attention. */
  async run(workspaceId: string, fieldId: string, runId: string, built: BuiltInputs, asOf: string): Promise<number> {
    const { inputs } = built;
    let created = 0;
    const results: Array<[AlertResult["subject"], AlertResult["type"], AlertResult | null]> = [
      ["frost_alert", "weather", frostAlert(inputs, asOf)],
      ["water_stress", "irrigation", waterStress(inputs, built.waterSite, asOf)],
    ];
    for (const [subject, type, r] of results) {
      if (await this.upsert(workspaceId, fieldId, runId, subject, type, r, built, asOf)) created += 1;
    }
    return created;
  }

  private async upsert(
    workspaceId: string,
    fieldId: string,
    runId: string,
    subject: string,
    type: "weather" | "irrigation",
    r: AlertResult | null,
    built: BuiltInputs,
    asOf: string,
  ): Promise<boolean> {
    const { inputs } = built;
    const season = inputs.season;
    const where = { fieldId, type, subject, season, status: { in: LIVE } };
    if (!r || r.level === "none") {
      // No longer applies: the open or snoozed item leaves the brief (accepted and reported items stay as they are).
      await this.prisma.system.recommendation.updateMany({
        where: { ...where, status: { in: ["open", "snoozed"] } },
        data: { status: "superseded" },
      });
      return false;
    }
    const cutoff = new Date(Date.parse(`${asOf}T00:00:00Z`) - SNAPSHOT_WEATHER_DAYS * 864e5)
      .toISOString()
      .slice(0, 10);
    const payload = {
      asOf,
      inputs: { ...inputs, weather: inputs.weather.filter((w) => w.date >= cutoff) },
      waterSite: subject === "water_stress" ? built.waterSite : null,
      weatherFrom: cutoff,
    };
    const hash = createHash("sha256")
      .update(stableStringify({ subject, payload, modelVersion: MODEL_VERSION }))
      .digest("hex");
    return this.prisma.system.$transaction(async (tx) => {
      const snap = await tx.inputSnapshot.upsert({
        where: { hash },
        create: { hash, payload: payload as unknown as Prisma.InputJsonValue },
        update: {},
        select: { id: true },
      });
      const existing = await tx.recommendation.findFirst({ where });
      const data = {
        level: r.level as "low" | "moderate" | "high",
        confidence: r.confidence,
        tier: inputs.tier,
        deadline: r.deadline ? new Date(`${r.deadline}T00:00:00Z`) : null,
        irreversible: r.irreversible,
        planning: false,
        keyNumbers: r.keyNumbers as unknown as Prisma.InputJsonValue,
        drivers: r.drivers as unknown as Prisma.InputJsonValue,
        evidence: [
          ...r.evidence,
          ...r.citations.map((c) => ({ kind: "citation", ...c })),
        ] as unknown as Prisma.InputJsonValue,
        unknowns: r.unknowns as unknown as Prisma.InputJsonValue,
        modelRef: `${subject}@${MODEL_VERSION}`,
        versions: { ...this.lib.versions, alerts: MODEL_VERSION } as unknown as Prisma.InputJsonValue,
        inputSnapshotId: snap.id,
      };
      if (!existing) {
        const rec = await tx.recommendation.create({
          data: { workspaceId, fieldId, type, subject, season, ...data },
        });
        await tx.recommendationLevel.create({
          data: { recommendationId: rec.id, runId, level: r.level, confidence: r.confidence },
        });
        return ORDER[r.level] >= ORDER.moderate;
      }
      // Dismissed stays dismissed unless the level rises or a later event (new deadline) replaces the dismissed one;
      // a snooze ends at the next morning run if it still fires.
      const rose = ORDER[r.level] > ORDER[existing.level];
      const later = Boolean(data.deadline && existing.deadline && data.deadline > existing.deadline);
      const reopen =
        (existing.status === "dismissed" && (rose || later)) ||
        (existing.status === "snoozed" && (!existing.snoozedUntil || existing.snoozedUntil <= new Date()));
      await tx.recommendation.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(reopen ? { status: "open", snoozedAt: null, snoozedUntil: null, dismissedAt: null } : {}),
        },
      });
      await tx.recommendationLevel.create({
        data: { recommendationId: existing.id, runId, level: r.level, confidence: r.confidence },
      });
      return false;
    });
  }
}
