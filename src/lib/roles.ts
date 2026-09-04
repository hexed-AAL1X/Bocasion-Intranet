import type { UserRole } from "@/components/AuthGate";

export function isStaffRole(role: UserRole | string | null | undefined): boolean {
  return role === "admin" || role === "dev";
}

export function canEditProgramaAnual(role: UserRole | string | null | undefined): boolean {
  return isStaffRole(role);
}
