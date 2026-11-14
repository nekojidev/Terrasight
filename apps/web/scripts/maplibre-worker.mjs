// MapLibre loads its worker from next to its own module, which the Next.js bundle breaks ("Worker failed to load":
// tiles still draw, GeoJSON layers such as the field outline do not). Copy the worker to public/ so FieldMap can
// point setWorkerUrl at a stable same-origin path. Runs before dev, build and start.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkg = require.resolve("maplibre-gl/package.json");
const out = join(dirname(fileURLToPath(import.meta.url)), "../public");
mkdirSync(out, { recursive: true });
copyFileSync(join(dirname(pkg), "dist/maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
