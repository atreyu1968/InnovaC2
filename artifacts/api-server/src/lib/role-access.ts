import type { UserRole } from "@workspace/api-zod";

/** Technical administration inherits operational roles without impersonating them. */
export function hasCoordinationAccess(role: UserRole): boolean {
  return role === "c2_innovacion" || role === "admin_tecnico";
}
