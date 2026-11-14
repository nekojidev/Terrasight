#!/usr/bin/env node
// validate-library [dataDir]: loads every library file through the same loader the API uses, including the
// pest-model verification gate (RFC §11.3). Prints crops still missing prices (S-06.05) as a warning.
import { fileURLToPath } from "node:url";
import { loadLibrary, LibraryError, missingPrices } from "./load.js";

const dir = process.argv[2] ?? fileURLToPath(new URL("../../../data/", import.meta.url));
try {
  const lib = loadLibrary(dir);
  console.log(
    `library valid: ${lib.rotations.rotations.length} rotations, ${Object.keys(lib.rotations.regions).length} regions, ` +
      `${lib.pests.pests.length} pests, ${lib.enabledModels.length}/${lib.pestModels.models.length} pest models enabled`,
  );
  const missing = missingPrices(lib);
  const demo = ["us-southern-plains", "us-central-high-plains"].filter((r) => missing[r]);
  if (demo.length)
    console.warn(`warning: prices missing for demo regions ${demo.join(", ")} (fill before EP-06, S-06.05)`);
} catch (e) {
  if (e instanceof LibraryError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
