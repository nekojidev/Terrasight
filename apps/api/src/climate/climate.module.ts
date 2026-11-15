import { Module } from "@nestjs/common";
import { FieldsModule } from "../fields/fields.module.js";
import { ClimateController } from "./climate.controller.js";
import type { DailyWeather } from "@terrasight/sources";
import { GpmModule } from "../gpm/gpm.module.js";
import { GpmService } from "../gpm/gpm.service.js";
import { ClimateService, GPM_CHECK_PROVIDER, type GpmCheckProvider } from "./climate.service.js";

/**
 * EP-10: climate shift of a field from the cached NASA POWER series. The GPM module supplies the IMERG
 * cross-check through `GPM_CHECK_PROVIDER`; when IMERG is not readable the check comes back "unavailable".
 */
@Module({
  imports: [FieldsModule, GpmModule],
  controllers: [ClimateController],
  providers: [
    ClimateService,
    {
      // The GPM IMERG check reads only dates and precipitation of the POWER series.
      provide: GPM_CHECK_PROVIDER,
      inject: [GpmService],
      useFactory: (gpm: GpmService): GpmCheckProvider => ({
        check: ({ lat, lon, daily }) =>
          gpm.check(lat, lon, { dates: daily.dates, values: { PRECTOTCORR: daily.precip } } as unknown as DailyWeather),
      }),
    },
  ],
  exports: [ClimateService],
})
export class ClimateModule {}
