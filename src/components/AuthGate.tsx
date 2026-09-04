"use client";

import { FormEvent, ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { FiLock, FiUser } from "react-icons/fi";
import styles from "./AuthGate.module.css";
import { resolveUsersApi, resolveSessionApi } from "@/utils/api";
import { poppins } from "@/fonts";
import { GlobalShortcuts } from "./GlobalShortcuts";
import { LoginHeroDecorations } from "./LoginHeroDecorations";
import { sanitizeDepartmentAreas } from "@/lib/departments";

export type UserRole = "user" | "admin" | "dev";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  areas: string[];
};

const STORAGE_KEY = "bocasion-auth-v2";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const asset = (path: string) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

const BRAND = {
  logo: "/branding/logo-login.svg",
} as const;

type AuthContextValue = {
  authorized: boolean;
  user: SessionUser | null;
  role: UserRole | null;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthSession() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthSession must be used within AuthGate");
  return ctx;
}

function parseSessionUser(data: Record<string, unknown>): SessionUser | null {
  const id = typeof data.id === "string" ? data.id : "";
  const username = typeof data.username === "string" ? data.username : "";
  const displayName = typeof data.displayName === "string" ? data.displayName : username;
  const role = data.role;
  if (!id || !username || (role !== "user" && role !== "admin" && role !== "dev")) return null;
  const areas = sanitizeDepartmentAreas(Array.isArray(data.areas) ? data.areas : []);
  return { id, username, displayName, role, areas };
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const authorized = user !== null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(resolveSessionApi(), { credentials: "include" });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const sessionUser = parseSessionUser(data);
          if (sessionUser) {
            setUser(sessionUser);
            setHydrated(true);
            return;
          }
        }
      } catch {
        /* red privada o export sin API */
      }
      try {
        const stored = window.sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Record<string, unknown>;
          const sessionUser = parseSessionUser(parsed);
          if (sessionUser) setUser(sessionUser);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    void fetch(resolveUsersApi(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "logout" }),
    }).finally(() => {
      setUser(null);
      setUsername("");
      setPassword("");
      setError(null);
      setTries(0);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    });
  }, []);

  const contextValue = useMemo<AuthContextValue>(
    () => ({ authorized, user, role: user?.role ?? null, logout }),
    [authorized, user, logout]
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(resolveUsersApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "login", username, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          (data && typeof data === "object" && data && "error" in data && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : null) || "Credenciales incorrectas";
        setError(msg);
        setTries((prev) => prev + 1);
        return;
      }
      const sessionUser = parseSessionUser(data as Record<string, unknown>);
      if (!sessionUser) {
        setError("Respuesta de sesión inválida");
        return;
      }
      setUser(sessionUser);
      setUsername("");
      setPassword("");
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("auth error", err);
      setError("Error de conexión");
    } finally {
      setVerifying(false);
    }
  };

  if (!hydrated) return null;

  if (authorized) {
    return (
      <AuthContext.Provider value={contextValue}>
        {children}
        <GlobalShortcuts />
      </AuthContext.Provider>
    );
  }

  return (
    <div className={`${styles.wrapper} ${poppins.className}`} data-auth-gate="login">
      <div className={styles.formSide}>
        <LoginHeroDecorations variant="light" />
        <div className={styles.formShell}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logo intranet Bocasión */}
            <img src={asset(BRAND.logo)} alt="Bocasión" className={styles.logo} />
          </div>

          <div className={styles.cardHead}>
            <h1>¡Te damos la bienvenida!</h1>
            <p>Ingresa tus credenciales para continuar.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Usuario</span>
              <div className={styles.inputWrap}>
                <FiUser className={styles.inputIcon} aria-hidden />
                <input
                  type="text"
                  value={username}
                  autoComplete="username"
                  placeholder="Tu usuario"
                  className={styles.input}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Contraseña</span>
              <div className={styles.inputWrap}>
                <FiLock className={styles.inputIcon} aria-hidden />
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  placeholder="Tu contraseña"
                  className={styles.input}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </label>

            {error ? (
              <p className={styles.error} data-login-error role="alert">
                {error}
              </p>
            ) : null}
            {tries > 0 && !error ? <p className={styles.retries}>Intentos: {tries}</p> : null}

            <button type="submit" className={styles.button} disabled={!username || !password || verifying}>
              {verifying ? "Validando…" : "Iniciar sesión"}
            </button>
          </form>

          <p className={styles.footerNote}>Bocasión · Acceso exclusivo para colaboradores</p>
        </div>
      </div>

      <aside className={styles.heroSide} aria-hidden>
        <LoginHeroDecorations />
        <div className={styles.heroInner}>
          <h2 className={styles.heroTitle}>
            Un lugar de trabajo <span>más feliz :)</span>
          </h2>
          <p className={styles.heroSub}>
            Experiencias que conectan personas, equipos y momentos que importan.
          </p>
        </div>
      </aside>
    </div>
  );
}
