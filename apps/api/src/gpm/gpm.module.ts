import { Module } from "@nestjs/common";
import { GPM_CHECK_PROVIDER, GpmService } from "./gpm.service.js";

/** GPM IMERG rainfall check (S-10.11). The climate module injects `GPM_CHECK_PROVIDER` as its optional hook. */
@Module({
  providers: [GpmService, { provide: GPM_CHECK_PROVIDER, useExisting: GpmService }],
  exports: [GpmService, GPM_CHECK_PROVIDER],
})
export class GpmModule {}
