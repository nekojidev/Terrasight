import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  PestModelsFile,
  PestsFile,
  PricesFile,
  RotationsFile,
  type PestModel,
  type SequenceItem,
} from "./schemas.js";

export interface LibraryVersions {
  rotations: string;
  pests: string;
  pestModels: string;
  prices: string;
}

export interface Library {
  rotations: RotationsFile;
  pests: PestsFile;
  pestModels: PestModelsFile;
  prices: PricesFile;
  /** Content hash (first 12 hex of sha256) of each file, stored with every result (RFC §16). */
  versions: LibraryVersions;
  /** Models that are enabled and passed the verification gate. */
  enabledModels: PestModel[];
}

export class LibraryError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Library is invalid:\n  - ${problems.join("\n  - ")}`);
    this.name = "LibraryError";
  }
}

const FILES = {
  rotations: "rotations.json",
  pests: "pests.json",
  pestModels: "pest-models.json",
  prices: "prices.json",
} as const;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function parse<T extends z.ZodType>(
  schema: T,
  text: string,
  file: string,
  problems: string[],
): z.infer<T> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    problems.push(`${file}: not valid JSON (${(e as Error).message})`);
    return null;
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    for (const issue of result.error.issues.slice(0, 20)) {
      problems.push(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return null;
  }
  return result.data;
}

export function seqCrops(item: SequenceItem): string[] {
  return typeof item === "string" ? [item] : [item.main, item.second];
}

function collectRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectRefs(n, out));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.ref === "string" && Object.keys(obj).length === 1) out.add(obj.ref);
    Object.values(obj).forEach((v) => collectRefs(v, out));
  }
}

type LibraryFiles = Pick<Library, "rotations" | "pests" | "pestModels" | "prices">;

/** Cross-file checks and the verification gate (RFC §11.3). Returns problems; empty = valid. */
export function checkLibrary(lib: LibraryFiles): { problems: string[]; enabledModels: PestModel[] } {
  const problems: string[] = [];
  const { rotations, pests, pestModels } = lib;
  const crops = new Set(Object.keys(rotations.crops));
  const regions = new Set(Object.keys(rotations.regions));

  const ids = new Set<string>();
  const perRegion = new Map<string, { count: number; baseline: number }>();
  for (const r of rotations.rotations) {
    if (ids.has(r.id)) problems.push(`rotations.json: duplicate id ${r.id}`);
    ids.add(r.id);
    if (!regions.has(r.region)) problems.push(`rotations.json: ${r.id}: unknown region ${r.region}`);
    for (const c of r.sequence.flatMap(seqCrops)) {
      if (!crops.has(c)) problems.push(`rotations.json: ${r.id}: unknown crop ${c}`);
    }
    if (r.cover && !crops.has(r.cover)) problems.push(`rotations.json: ${r.id}: unknown cover ${r.cover}`);
    const n = perRegion.get(r.region) ?? { count: 0, baseline: 0 };
    n.count += 1;
    n.baseline += r.baseline ? 1 : 0;
    perRegion.set(r.region, n);
  }
  for (const id of regions) {
    const n = perRegion.get(id) ?? { count: 0, baseline: 0 };
    if (n.count < 3) problems.push(`rotations.json: region ${id} has ${n.count} rotations, needs 3`);
    if (n.baseline < 1) problems.push(`rotations.json: region ${id} has no baseline`);
  }

  const pestIds = new Set<string>();
  for (const p of pests.pests) {
    pestIds.add(p.id);
    for (const c of p.crops) if (!crops.has(c)) problems.push(`pests.json: ${p.id}: unknown crop ${c}`);
    for (const r of p.regions) if (!regions.has(r)) problems.push(`pests.json: ${p.id}: unknown region ${r}`);
    for (const d of p.drivers)
      if (!(d in pests.drivers)) problems.push(`pests.json: ${p.id}: unknown driver ${d}`);
    for (const s of p.signals)
      if (!(s in pests.signals)) problems.push(`pests.json: ${p.id}: unknown signal ${s}`);
  }

  const enabledModels: PestModel[] = [];
  for (const m of pestModels.models) {
    const where = `pest-models.json: ${m.pest}`;
    if (!pestIds.has(m.pest)) problems.push(`${where}: no such pest in pests.json`);
    if (m.stageWindow && !crops.has(m.stageWindow.crop))
      problems.push(`${where}: unknown crop ${m.stageWindow.crop}`);
    const refs = new Set<string>();
    collectRefs(m.tree, refs);
    for (const ref of refs)
      if (!(ref in m.thresholds)) problems.push(`${where}: tree refers to missing threshold ${ref}`);

    if (!m.enabled) continue;
    // Verification gate: an enabled model needs every threshold verified, valued and cited.
    const all = Object.entries(m.thresholds);
    if (m.scoutAction) all.push(["scoutAction", m.scoutAction]);
    let ok = true;
    for (const [key, t] of all) {
      const s = t.source;
      if (!t.verified || t.value === null || !t.verifiedBy || !s?.title || !s.url || !s.accessed) {
        problems.push(`${where}: enabled but threshold ${key} is not verified, valued and cited`);
        ok = false;
      }
    }
    if (ok) enabledModels.push(m);
  }
  return { problems, enabledModels };
}

/** Loads and validates every library file. Throws LibraryError listing every problem found. */
export function loadLibrary(dataDir: string): Library {
  const problems: string[] = [];
  const read = (file: string): string => {
    try {
      return readFileSync(join(dataDir, file), "utf8");
    } catch {
      problems.push(`${file}: cannot read from ${dataDir}`);
      return "";
    }
  };
  const texts = {
    rotations: read(FILES.rotations),
    pests: read(FILES.pests),
    pestModels: read(FILES.pestModels),
    prices: read(FILES.prices),
  };
  if (problems.length) throw new LibraryError(problems);

  const rotations = parse(RotationsFile, texts.rotations, FILES.rotations, problems);
  const pests = parse(PestsFile, texts.pests, FILES.pests, problems);
  const pestModels = parse(PestModelsFile, texts.pestModels, FILES.pestModels, problems);
  const prices = parse(PricesFile, texts.prices, FILES.prices, problems);
  if (!rotations || !pests || !pestModels || !prices) throw new LibraryError(problems);

  const checked = checkLibrary({ rotations, pests, pestModels, prices });
  if (checked.problems.length) throw new LibraryError(checked.problems);

  return {
    rotations,
    pests,
    pestModels,
    prices,
    enabledModels: checked.enabledModels,
    versions: {
      rotations: hash(texts.rotations),
      pests: hash(texts.pests),
      pestModels: hash(texts.pestModels),
      prices: hash(texts.prices),
    },
  };
}

/** Crops used by each region that have neither a regional price nor a country fallback (S-06.05). */
export function missingPrices(lib: LibraryFiles): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [regionId, region] of Object.entries(lib.rotations.regions)) {
    const used = new Set(
      lib.rotations.rotations
        .filter((r) => r.region === regionId)
        .flatMap((r) => r.sequence.flatMap(seqCrops))
        .filter((c) => c !== "fallow"),
    );
    const regional = lib.prices.regions[regionId]?.crops ?? {};
    const missing = [...used].filter(
      (c) => !regional[c] && !region.countries.some((country) => lib.prices.fallback.byCountry[country]?.[c]),
    );
    if (missing.length) out[regionId] = missing.sort();
  }
  return out;
}
