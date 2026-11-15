/** Interface permissions by workspace role. The API stays the authority; this only decides which controls to show. */
export type WorkspaceRole = "owner" | "agronomist";

/** The Agronomist does the field work (save a plan, accept, ask); the Owner reads and answers decisions. */
export function canDoFieldWork(role: string): boolean {
  return role !== "owner";
}
