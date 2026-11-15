import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, Requires, WorkspaceGuard, type AuthedRequest } from "../auth/current-user.js";
import { ZodPipe } from "../http/zod.js";
import { CropPricesService } from "./crop-prices.service.js";

const Row = z.object({
  crop: z.string().trim().min(1).max(40),
  pricePerT: z.number().positive().max(1_000_000),
  variableCostPerHa: z.number().min(0).max(10_000_000),
  yieldRefTHa: z.number().positive().max(200).nullable().optional(),
  irrigated: z.boolean().nullable().optional(),
});
export const PutBody = z
  .object({
    rows: z.array(Row).max(60).default([]),
    remove: z.array(z.string().trim().min(1).max(40)).max(60).optional(),
  })
  .refine((b) => b.rows.length > 0 || (b.remove?.length ?? 0) > 0, "nothing to change")
  .refine(
    (b) => new Set(b.rows.map((r) => `${r.crop}|${r.irrigated ?? "any"}`)).size === b.rows.length,
    "duplicate crop",
  );

/** The company's own crop prices (Owner and Agronomist). Amounts are in the workspace currency. */
@Controller("w/:ws/crop-prices")
@UseGuards(AuthGuard, WorkspaceGuard)
export class CropPricesController {
  constructor(private readonly prices: CropPricesService) {}

  @Get()
  @Requires("cropPrices.manage")
  list(@Req() req: AuthedRequest) {
    return this.prices.list(req.workspaceId!, req.role);
  }

  @Put()
  @Requires("cropPrices.manage")
  put(@Body(new ZodPipe(PutBody)) body: z.infer<typeof PutBody>, @Req() req: AuthedRequest) {
    return this.prices.put(req.workspaceId!, req.user!.id, body);
  }
}
