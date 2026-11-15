import type { Role } from "../generated/prisma/enums.js";

/**
 * Permission matrix (Tech Design §14.1). The report link (EP-08) is handled by its own guard and can only
 * read the Owner report and answer items.
 */
export const PERMISSIONS = {
  // Owner only: the company, its people, report links, decisions.
  "workspace.delete": ["owner"],
  billing: ["owner"],
  "workspace.settings": ["owner"],
  "members.manage": ["owner"],
  "reportLinks.manage": ["owner"],
  "report.answer": ["owner"],
  // Field work: the Agronomist, and the Owner too.
  "fields.write": ["owner", "agronomist"],
  "analysis.run": ["owner", "agronomist"],
  "recommendations.act": ["owner", "agronomist"],
  "outcomes.record": ["owner", "agronomist"],
  "scouting.use": ["owner", "agronomist"],
  "assistant.use": ["owner", "agronomist"],
  "plans.save": ["owner", "agronomist"],
  "brief.read": ["owner", "agronomist"],
  "fields.read": ["owner", "agronomist"],
  "scenarios.explore": ["owner", "agronomist"],
  "report.read": ["owner", "agronomist"],
  "workspace.read": ["owner", "agronomist"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
