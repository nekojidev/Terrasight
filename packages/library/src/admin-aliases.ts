/**
 * Old → current ISO 3166-2 codes (Tech Design §6.3).
 *
 * Natural Earth admin-1 can carry codes that ISO has since replaced. We map them here instead of
 * editing rotations.json. Entries are added when region.test.ts, run against the loaded boundaries
 * (S-02.02), finds a point whose derived code matches no rule.
 *
 * The China entries are the 2017 change from numeric to letter codes; confirm them in S-02.02.
 */
export const ADMIN_ALIASES: Readonly<Record<string, string>> = {
  "CN-13": "CN-HE", // Hebei
  "CN-37": "CN-SD", // Shandong
  "CN-41": "CN-HA", // Henan
};

export function normaliseAdminCode(code: string): string {
  const upper = code.trim().toUpperCase();
  return ADMIN_ALIASES[upper] ?? upper;
}
