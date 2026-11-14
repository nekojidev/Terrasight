import { Global, Logger, Module } from "@nestjs/common";
import { loadLibrary, type Library } from "@terrasight/library";
import { ENV, type Env } from "../config/config.js";

export const LIBRARY = Symbol("LIBRARY");

/** Loads and validates the library files at boot; an invalid library stops the process (S-00.07). */
@Global()
@Module({
  providers: [
    {
      provide: LIBRARY,
      inject: [ENV],
      useFactory: (env: Env): Library => {
        const lib = loadLibrary(env.DATA_DIR);
        new Logger("Library").log(
          `Loaded ${lib.rotations.rotations.length} rotations, ${lib.pests.pests.length} pests, ` +
            `${lib.enabledModels.length}/${lib.pestModels.models.length} models enabled ` +
            `(versions ${Object.entries(lib.versions)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ")})`,
        );
        return lib;
      },
    },
  ],
  exports: [LIBRARY],
})
export class LibraryModule {}
