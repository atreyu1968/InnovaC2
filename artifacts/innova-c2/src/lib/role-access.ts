import type { UserRole } from "@workspace/api-client-react";

export function hasCoordinationAccess(role: UserRole): boolean {
  return role === "c2_innovacion" || role === "admin_tecnico";
}
