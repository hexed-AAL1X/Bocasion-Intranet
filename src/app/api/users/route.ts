import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { apiLog } from "@/lib/api-log";
import { isLoginBody, isLogoutBody } from "@/lib/api-contracts";
import {
  SESSION_COOKIE_NAME,
  sessionPayloadFromPublicUser,
  signSessionPayload,
  getSessionSecret,
  verifySessionToken,
} from "@/lib/session-cookie";
import { sanitizeDepartmentAreas } from "@/lib/departments";

export const runtime = "nodejs";

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const loginBuckets = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 25;

function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = loginBuckets.get(ip) ?? [];
  const pruned = arr.filter((t) => now - t < LOGIN_WINDOW_MS);
  if (pruned.length >= LOGIN_MAX_ATTEMPTS) return true;
  pruned.push(now);
  loginBuckets.set(ip, pruned);
  return false;
}

export type UserRole = "user" | "admin" | "dev";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  areas: string[];
  createdAt: string;
  updatedAt: string;
};

type PublicUser = Omit<User, "passwordHash">;

function attachSessionCookie(res: NextResponse, pub: PublicUser) {
  const secret = getSessionSecret();
  const payload = sessionPayloadFromPublicUser(
    {
      id: pub.id,
      username: pub.username,
      displayName: pub.displayName,
      role: pub.role,
      areas: pub.areas ?? [],
    },
    SESSION_MAX_AGE_SEC
  );
  const token = signSessionPayload(payload, secret);
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

function clearSessionCookie(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function stripPassword(user: User): PublicUser {
  const clone = { ...user };
  delete (clone as Partial<User>).passwordHash;
  return clone as PublicUser;
}

const dataDir = DATA_DIR;
const usersPath = path.join(dataDir, "users.json");
const generateId = () => `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

async function hashPassword(value: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(value).digest("hex");
}

async function readUsers(): Promise<User[]> {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const data = await fs.readFile(usersPath, "utf-8");
    return Array.isArray(JSON.parse(data)) ? JSON.parse(data) : [];
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") {
      // Seed with a default dev user (password: "123")
      const now = new Date().toISOString();
      const devHash = await hashPassword("123");
      const seed: User[] = [
        { id: "user_dev_seed", username: "dev", passwordHash: devHash, displayName: "Desarrollador", role: "dev", areas: [], createdAt: now, updatedAt: now },
      ];
      await writeUsers(seed);
      return seed;
    }
    throw err;
  }
}

async function writeUsers(users: User[]) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(usersPath, JSON.stringify(users, null, 2), "utf-8");
}

const respondError = (err: unknown) => {
  console.error("/api/users error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

// GET — list users (without passwordHash) or login
export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action");

    // Login action (legacy URL — prefer POST JSON)
    if (action === "login") {
      const ip = clientIp(request);
      if (loginRateLimited(ip)) {
        apiLog("users.login_rate_limited", { ip });
        return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
      }
      const username = request.nextUrl.searchParams.get("username") || "";
      const password = request.nextUrl.searchParams.get("password") || "";
      const users = await readUsers();
      const hash = await hashPassword(password);
      const user = users.find((u) => u.username === username && u.passwordHash === hash);
      if (!user) {
        apiLog("users.login_fail", { ip, username });
        return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
      }
      const pub = stripPassword(user);
      const res = NextResponse.json(pub);
      attachSessionCookie(res, pub);
      apiLog("users.login_ok", { ip, username: pub.username, via: "get" });
      return res;
    }

    if (action === "session") {
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!token) {
        return NextResponse.json({ authenticated: false });
      }
      const payload = verifySessionToken(token, getSessionSecret());
      if (!payload) {
        return NextResponse.json({ authenticated: false });
      }
      // Áreas frescas desde disco (por si se editaron después del login)
      const users = await readUsers();
      const fresh = users.find((u) => u.id === payload.id);
      const areas = fresh ? sanitizeDepartmentAreas(fresh.areas) : (payload.areas ?? []);
      return NextResponse.json({
        authenticated: true,
        id: payload.id,
        username: payload.username,
        displayName: payload.displayName,
        role: payload.role,
        areas,
      });
    }

    // List users (admin/dev only — authorization checked client side)
    const users = await readUsers();
    const safe = users.map(stripPassword);
    return NextResponse.json(safe);
  } catch (err) {
    return respondError(err);
  }
}

// POST — login / logout / crear usuario
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = clientIp(request);

    if (isLogoutBody(body)) {
      const res = NextResponse.json({ ok: true });
      clearSessionCookie(res);
      apiLog("users.logout", { ip });
      return res;
    }

    if (isLoginBody(body)) {
      if (loginRateLimited(ip)) {
        apiLog("users.login_rate_limited", { ip });
        return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
      }
      const username = body.username.trim();
      const password = body.password;
      if (!username || !password) {
        return NextResponse.json({ error: "username y password requeridos" }, { status: 400 });
      }
      const users = await readUsers();
      const hash = await hashPassword(password);
      const user = users.find((u) => u.username === username && u.passwordHash === hash);
      if (!user) {
        apiLog("users.login_fail", { ip, username });
        return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
      }
      const pub = stripPassword(user);
      const res = NextResponse.json(pub);
      attachSessionCookie(res, pub);
      apiLog("users.login_ok", { ip, username: pub.username, via: "post" });
      return res;
    }

    // Actualizar vía POST (action=update) — mismo contrato que PUT / hosting PHP
    if ((body as { action?: string }).action === "update") {
      const callerRole = getCallerRole(request);
      if (callerRole !== "dev") {
        return NextResponse.json({ error: "Solo los devs pueden editar usuarios" }, { status: 403 });
      }
      if (!(body as { id?: string }).id) {
        return NextResponse.json({ error: "id requerido" }, { status: 400 });
      }
      const users = await readUsers();
      const idx = users.findIndex((u) => u.id === (body as { id: string }).id);
      if (idx === -1) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

      const now = new Date().toISOString();
      const existing = users[idx];
      const validRoles: UserRole[] = ["user", "admin", "dev"];
      const b = body as Record<string, unknown>;

      if (b.displayName !== undefined) existing.displayName = String(b.displayName).trim();
      if (b.role && validRoles.includes(b.role as UserRole)) existing.role = b.role as UserRole;
      if (b.password) existing.passwordHash = await hashPassword(String(b.password));
      if (b.areas !== undefined) existing.areas = sanitizeDepartmentAreas(b.areas);
      if (b.username) {
        const taken = users.some((u) => u.username === b.username && u.id !== existing.id);
        if (taken) return NextResponse.json({ error: "Nombre de usuario en uso" }, { status: 409 });
        existing.username = String(b.username).trim();
      }
      existing.updatedAt = now;
      users[idx] = existing;
      await writeUsers(users);
      return NextResponse.json(stripPassword(existing));
    }

    const { username, password, displayName, role } = body as Record<string, unknown>;
    if (!username || !password) {
      return NextResponse.json({ error: "username y password requeridos" }, { status: 400 });
    }
    const validRoles: UserRole[] = ["user", "admin", "dev"];
    const userRole: UserRole = validRoles.includes(role as UserRole) ? (role as UserRole) : "user";

    const users = await readUsers();
    if (users.some((u) => u.username === username)) {
      return NextResponse.json({ error: "El nombre de usuario ya existe" }, { status: 409 });
    }

    const now = new Date().toISOString();
    const userAreas = sanitizeDepartmentAreas((body as { areas?: unknown }).areas);
    const newUser: User = {
      id: generateId(),
      username: String(username).trim(),
      passwordHash: await hashPassword(String(password)),
      displayName: String(displayName || username).trim(),
      role: userRole,
      areas: userAreas,
      createdAt: now,
      updatedAt: now,
    };
    users.push(newUser);
    await writeUsers(users);
    return NextResponse.json(stripPassword(newUser));
  } catch (err) {
    return respondError(err);
  }
}

function getCallerRole(request: NextRequest): UserRole | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  return payload?.role as UserRole ?? null;
}

function getCallerId(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  return payload?.id as string ?? null;
}

// PUT — update user (dev only)
export async function PUT(request: NextRequest) {
  try {
    const callerRole = getCallerRole(request);
    if (callerRole !== "dev") {
      return NextResponse.json({ error: "Solo los devs pueden editar usuarios" }, { status: 403 });
    }
    const body = await request.json();
    if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    const users = await readUsers();
    const idx = users.findIndex((u) => u.id === body.id);
    if (idx === -1) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

    const now = new Date().toISOString();
    const existing = users[idx];
    const validRoles: UserRole[] = ["user", "admin", "dev"];

    if (body.displayName !== undefined) existing.displayName = String(body.displayName).trim();
    if (body.role && validRoles.includes(body.role)) existing.role = body.role;
    if (body.password) existing.passwordHash = await hashPassword(String(body.password));
    if (body.areas !== undefined) {
      existing.areas = sanitizeDepartmentAreas(body.areas);
    }
    if (body.username) {
      const taken = users.some((u) => u.username === body.username && u.id !== body.id);
      if (taken) return NextResponse.json({ error: "Nombre de usuario en uso" }, { status: 409 });
      existing.username = String(body.username).trim();
    }
    existing.updatedAt = now;
    users[idx] = existing;
    await writeUsers(users);
    return NextResponse.json(stripPassword(existing));
  } catch (err) {
    return respondError(err);
  }
}

// DELETE — delete user (dev only)
export async function DELETE(request: NextRequest) {
  try {
    const callerRole = getCallerRole(request);
    if (callerRole !== "dev") {
      return NextResponse.json({ error: "Solo los devs pueden eliminar usuarios" }, { status: 403 });
    }
    const body = await request.json();
    if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    const users = await readUsers();
    const target = users.find((u) => u.id === body.id);
    if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    // Prevent deleting the last dev user
    if (target.role === "dev") {
      const devCount = users.filter((u) => u.role === "dev").length;
      if (devCount <= 1) {
        return NextResponse.json({ error: "No se puede eliminar el último usuario dev" }, { status: 400 });
      }
    }
    // Prevent self-deletion
    const callerId = getCallerId(request);
    if (callerId === body.id) {
      return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
    }
    const filtered = users.filter((u) => u.id !== body.id);
    await writeUsers(filtered);
    // Clean up orphaned notion data
    const safeUserId = String(body.id).replace(/[^a-zA-Z0-9_-]/g, "");
    if (safeUserId) {
      const tabsFile = path.join(dataDir, `notion-tabs.${safeUserId}.json`);
      try {
        const tabsRaw = await fs.readFile(tabsFile, "utf-8");
        const tabsData = JSON.parse(tabsRaw);
        const allTabs = [...(tabsData.tabs || []), ...(tabsData.trash || [])];
        for (const tab of allTabs) {
          const sid = String(tab.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
          if (!sid) continue;
          try { await fs.unlink(path.join(dataDir, `tasks.${sid}.json`)); } catch {}
          try { await fs.unlink(path.join(dataDir, `columns.${sid}.json`)); } catch {}
        }
        await fs.unlink(tabsFile);
      } catch {}
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return respondError(err);
  }
}
