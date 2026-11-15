import { Inject, Injectable } from "@nestjs/common";
import type { Library } from "@terrasight/library";
import { PrismaService } from "../db/prisma.service.js";
import { ProblemException } from "../http/problem.js";
import { LIBRARY } from "../library/library.module.js";
import type { CompanyPrice } from "../scenarios/price-resolution.js";

export interface CropPriceInput {
  crop: string;
  pricePerT: number;
  variableCostPerHa: number;
  yieldRefTHa?: number | null;
  irrigated?: boolean | null;
}

export interface PutCropPrices {
  rows: CropPriceInput[];
  /** Crops whose rows are deleted. */
  remove?: string[];
}

/** The company's own crop prices (user data): per crop, in the workspace currency, no conversion. */
@Injectable()
export class CropPricesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY) private readonly lib: Library,
  ) {}

  /** The workspace currency (workspaces are not a scoped model; the id comes from the guarded route). */
  async currency(workspaceId: string): Promise<string> {
    const ws = await this.prisma.system.workspace.findUnique({
      where: { id: workspaceId },
      select: { currency: true },
    });
    if (!ws) throw new ProblemException(404, "not-found");
    return ws.currency;
  }

  async rows(workspaceId: string): Promise<CompanyPrice[]> {
    const rows = await this.prisma.db.workspaceCropPrice.findMany({
      where: { workspaceId },
      orderBy: [{ crop: "asc" }, { irrigated: "asc" }],
    });
    return rows.map((r) => ({
      crop: r.crop,
      pricePerT: r.pricePerT,
      variableCostPerHa: r.variableCostPerHa,
      yieldRefTHa: r.yieldRefTHa,
      irrigated: r.irrigated,
      currency: r.currency,
    }));
  }

  async list(workspaceId: string, role: string | undefined) {
    const [currency, rows] = await Promise.all([this.currency(workspaceId), this.rows(workspaceId)]);
    return {
      currency,
      canChangeCurrency: role === "owner",
      crops: Object.entries(this.lib.rotations.crops)
        .filter(([id]) => id !== "fallow")
        .map(([id, c]) => ({ id, en: c.en, uk: c.uk })),
      rows: rows.map((r) => ({ ...r, usable: r.currency === currency })),
    };
  }

  async put(workspaceId: string, userId: string, body: PutCropPrices) {
    const known = this.lib.rotations.crops;
    for (const c of [...body.rows.map((r) => r.crop), ...(body.remove ?? [])])
      if (!known[c] || c === "fallow")
        throw new ProblemException(422, "invalid-input", `Unknown crop: ${c}`, [
          { path: "crop", message: "unknown crop" },
        ]);
    const currency = await this.currency(workspaceId);
    // Interactive transaction: bypasses the scoped client on purpose, so every query carries workspaceId itself.
    await this.prisma.system.$transaction(async (tx) => {
      if (body.remove?.length)
        await tx.workspaceCropPrice.deleteMany({ where: { workspaceId, crop: { in: body.remove } } });
      for (const r of body.rows) {
        const irrigated = r.irrigated ?? null;
        await tx.workspaceCropPrice.deleteMany({ where: { workspaceId, crop: r.crop, irrigated } });
        await tx.workspaceCropPrice.create({
          data: {
            workspaceId,
            crop: r.crop,
            pricePerT: r.pricePerT,
            variableCostPerHa: r.variableCostPerHa,
            yieldRefTHa: r.yieldRefTHa ?? null,
            irrigated,
            currency,
            updatedBy: userId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          workspaceId,
          userId,
          action: "crop-prices.update",
          target: [...body.rows.map((r) => r.crop), ...(body.remove ?? []).map((c) => `-${c}`)].join(","),
        },
      });
    });
    return this.list(workspaceId, undefined);
  }
}
