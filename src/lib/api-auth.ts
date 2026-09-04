import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, getSessionSecret, verifySessionToken } from "@/lib/session-cookie";
import { isStaffRole } from "@/lib/roles";

export type AuthSession = {
  id: string;
  username: string;
  displayName: string;
  role: string;
};

export function getAuthFromRequest(request: NextRequest): AuthSession | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  if (!payload) return null;
  return {
    id: payload.id,
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
  };
}

export async function getAuthFromCookies(): Promise<AuthSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  if (!payload) return null;
  return {
    id: payload.id,
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
  };
}

export function requireStaffAuth(auth: AuthSession | null): auth is AuthSession {
  return auth !== null && isStaffRole(auth.role);
}
