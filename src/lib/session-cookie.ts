import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "dashboard_session";

export type SessionPayload = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  areas: string[];
  exp: number;
};

export function getSessionSecret(): string {
  return process.env.DASHBOARD_SESSION_SECRET?.trim() || "dev-dashboard-session-change-me";
}

/** Token: base64url(JSON).hexHMAC */
export function signSessionPayload(payload: SessionPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("hex");
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!data || !/^[0-9a-f]+$/i.test(sig)) return null;
  const expected = createHmac("sha256", secret).update(data).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const username = typeof o.username === "string" ? o.username : "";
  const displayName = typeof o.displayName === "string" ? o.displayName : "";
  const role = typeof o.role === "string" ? o.role : "";
  const exp = typeof o.exp === "number" ? o.exp : 0;
  const areas = Array.isArray(o.areas)
    ? o.areas.map((a) => String(a ?? "").trim()).filter(Boolean)
    : [];
  if (!id || !username || !role || !exp) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  return { id, username, displayName: displayName || username, role, areas, exp };
}

export function sessionPayloadFromPublicUser(
  user: { id: string; username: string; displayName: string; role: string; areas?: string[] },
  maxAgeSec: number
): SessionPayload {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    areas: Array.isArray(user.areas) ? user.areas.map(String).filter(Boolean) : [],
    exp,
  };
}
