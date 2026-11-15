import type { Role } from "../generated/prisma/enums.js";

/**
 * Permission matrix (Tech Design §14.1). The report link (EP-08) is handled by its own guard and can only
 * read the Owner report and answer items.
 */
export const PERMISSIONS = {
  "workspace.delete": ["owner"],
  billing: ["owner"],
  "workspace.settings": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  "reportLinks.manage": ["owner", "admin"],
  "fields.write": ["owner", "admin", "agronomist"],
  "analysis.run": ["owner", "admin", "agronomist"],
  "recommendations.act": ["owner", "admin", "agronomist"],
  "outcomes.record": ["owner", "admin", "agronomist"],
  "scouting.use": ["owner", "admin", "agronomist"],
  "assistant.use": ["owner", "admin", "agronomist"],
  "plans.save": ["owner", "admin", "agronomist"],
  "brief.read": ["owner", "admin", "agronomist"],
  "fields.read": ["owner", "admin", "agronomist"],
  "scenarios.explore": ["owner", "admin", "agronomist", "viewer"],
  "report.read": ["owner", "admin", "agronomist", "viewer"],
  "report.answer": ["owner", "viewer"],
  "workspace.read": ["owner", "admin", "agronomist", "viewer"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
