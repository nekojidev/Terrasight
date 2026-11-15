import { Global, Module } from "@nestjs/common";
import { AiBudgetService } from "./ai-budget.service.js";

/** Cross-cutting AI cost control: the daily Gemini budget. */
@Global()
@Module({ providers: [AiBudgetService], exports: [AiBudgetService] })
export class AiModule {}
