import { Module } from "@nestjs/common";
import { RetentionService } from "./retention.service.js";

/** Daily pruning of cache, snapshots, level history, run fields and read notifications. */
@Module({ providers: [RetentionService], exports: [RetentionService] })
export class RetentionModule {}
