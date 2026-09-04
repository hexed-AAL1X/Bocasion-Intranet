"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthSession } from "@/components/AuthGate";
import { userCanAccessPath } from "@/lib/departments";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function normalizePath(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) {
    const sliced = pathname.slice(BASE.length);
    return sliced || "/";
  }
  return pathname || "/";
}

/** Redirige al portal si la ruta no pertenece a las áreas del usuario. */
export function AreaAccessGate({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const path = normalizePath(pathname);
  const allowed = userCanAccessPath(auth.role, auth.user?.areas, path);

  useEffect(() => {
    if (!auth.authorized) return;
    if (allowed) return;
    router.replace("/");
  }, [auth.authorized, allowed, router, path]);

  if (auth.authorized && !allowed) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--text-dim)" }}>
        No tienes acceso a esta área del dashboard.
      </div>
    );
  }

  return <>{children}</>;
}
