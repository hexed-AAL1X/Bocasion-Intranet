/**
 * Contratos JSON compartidos entre cliente y rutas API (tipado; validación runtime mínima donde haga falta).
 */

export type UserRoleDto = "user" | "admin" | "dev";

export type LoginRequestBody = {
  action: "login";
  username: string;
  password: string;
};

export type LogoutRequestBody = {
  action: "logout";
};

export type PublicUserDto = {
  id: string;
  username: string;
  displayName: string;
  role: UserRoleDto;
  areas?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ApiErrorDto = {
  error: string;
};

export function isLoginBody(value: unknown): value is LoginRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.action === "login" && typeof v.username === "string" && typeof v.password === "string";
}

export function isLogoutBody(value: unknown): value is LogoutRequestBody {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).action === "logout";
}
