import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Flowering windows and heat thresholds per crop, `data/crop-flowering.json` (EP-10, S-10.02). Used by the climate
 * shift ("hot days at flowering"). Every value carries a checkable source; `verified` stays false until the owner
 * reviews it. Not part of `loadLibrary`: a missing or broken file never stops the API (the T5 fallback applies), but
 * `pnpm library:check` fails on it.
 */
const Mmdd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "expected MM-DD");

const Source = z.object({
  title: z.string().min(3),
  publisher: z.string().min(2),
  url: z.string().regex(/^https:\/\/[^\s]+$/, "expected an https URL"),
  accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date"),
});
const Sources = z.array(Source).min(1);

const CropEntry = z
  .object({
    threshold: z.object({ valueC: z.number().min(25).max(45), sources: Sources, note: z.string().optional() }).strict(),
    window: z
      .object({
        afterEmergence: z
          .object({
            from: z.number().int().min(0).max(250),
            to: z.number().int().min(0).max(250),
            sources: Sources,
            note: z.string().optional(),
          })
          .strict()
          .refine((w) => w.from <= w.to, "from must not be after to")
          .optional(),
        regions: z
          .record(z.string(), z.object({ from: Mmdd, to: Mmdd, sources: Sources, note: z.string().optional() }).strict())
          .optional(),
      })
      .strict()
      .refine((w) => w.afterEmergence || (w.regions && Object.keys(w.regions).length), "a window needs a rule"),
    // No `verifiedBy`: the owner adds the reviewer's name when the entry is reviewed.
    verified: z.boolean(),
  })
  .strict();

export const CropFloweringFile = z
  .object({
    version: z.number(),
    about: z.string(),
    fallback: z
      .object({
        thresholdC: z.number().min(25).max(45),
        north: z.object({ from: Mmdd, to: Mmdd }),
        south: z.object({ from: Mmdd, to: Mmdd }),
      })
      .strict(),
    crops: z.record(z.string(), CropEntry),
  })
  .strict();
export type CropFloweringFile = z.infer<typeof CropFloweringFile>;

/** Problems of the file against the rotation library's crops and regions (empty = valid). */
export function checkCropFlowering(
  file: CropFloweringFile,
  known: { crops: Iterable<string>; regions: Iterable<string> },
): string[] {
  const crops = new Set(known.crops);
  const regions = new Set(known.regions);
  const problems: string[] = [];
  for (const [id, c] of Object.entries(file.crops)) {
    if (!crops.has(id)) problems.push(`crop-flowering.json: ${id}: unknown crop`);
    for (const r of Object.keys(c.window.regions ?? {}))
      if (!regions.has(r)) problems.push(`crop-flowering.json: ${id}: unknown region ${r}`);
  }
  return problems;
}

export function loadCropFlowering(dataDir: string): CropFloweringFile | null {
  try {
    const parsed = CropFloweringFile.safeParse(JSON.parse(readFileSync(join(dataDir, "crop-flowering.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parses the file text; problems list the schema errors (empty = valid). */
export function parseCropFlowering(text: string): { file: CropFloweringFile | null; problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { file: null, problems: [`crop-flowering.json: not valid JSON (${(e as Error).message})`] };
  }
  const r = CropFloweringFile.safeParse(json);
  if (r.success) return { file: r.data, problems: [] };
  return {
    file: null,
    problems: r.error.issues.slice(0, 20).map((i) => `crop-flowering.json: ${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
