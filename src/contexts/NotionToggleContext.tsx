"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

const NOTION_RETURN_KEY = "dashboard-notion-return";
export const NOTION_CLOSE_MS = 340;
export const NOTION_OPEN_MS = 400;
const TRANSITION_SAFETY_MS = 1200;

export type NotionTransition = null | "open" | "close";

type NotionToggleContextValue = {
  notionTransition: NotionTransition;
  isNotionRoute: boolean;
  toggleNotion: () => void;
  consumeSuppressRouteEnter: () => boolean;
};

const NotionToggleContext = createContext<NotionToggleContextValue | null>(null);

function normalizePath(pathname: string) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (base && pathname.startsWith(base)) {
    const sliced = pathname.slice(base.length);
    return sliced || "/";
  }
  return pathname || "/";
}

export function NotionToggleProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const normalizedPath = normalizePath(pathname);
  const isNotionRoute = normalizedPath === "/notion" || normalizedPath.startsWith("/notion/");

  const [notionTransition, setNotionTransition] = useState<NotionTransition>(null);
  const suppressRouteEnterRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const consumeSuppressRouteEnter = useCallback(() => {
    if (!suppressRouteEnterRef.current) return false;
    suppressRouteEnterRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // Destino alcanzado tras cerrar Notion
  useEffect(() => {
    if (notionTransition !== "close" || isNotionRoute) return;

    suppressRouteEnterRef.current = true;
    setNotionTransition(null);
    clearTimers();
  }, [notionTransition, isNotionRoute, clearTimers]);

  // Notion visible: fin de animación de entrada
  useEffect(() => {
    if (notionTransition !== "open" || !isNotionRoute) return;

    clearTimers();
    openTimerRef.current = window.setTimeout(() => {
      setNotionTransition(null);
      openTimerRef.current = null;
    }, NOTION_OPEN_MS);

    return () => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    };
  }, [notionTransition, isNotionRoute, clearTimers]);

  // Respaldo: nunca dejar la transición colgada
  useEffect(() => {
    if (!notionTransition) return;

    const safetyTimer = window.setTimeout(() => {
      setNotionTransition(null);
      clearTimers();
    }, TRANSITION_SAFETY_MS);

    return () => window.clearTimeout(safetyTimer);
  }, [notionTransition, clearTimers]);

  const toggleNotion = useCallback(() => {
    if (notionTransition !== null) return;

    if (isNotionRoute) {
      setNotionTransition("close");
      clearTimers();

      let returnPath = "/";
      try {
        returnPath = sessionStorage.getItem(NOTION_RETURN_KEY) || "/";
      } catch {}

      closeTimerRef.current = window.setTimeout(() => {
        suppressRouteEnterRef.current = true;
        router.push(returnPath);
        closeTimerRef.current = null;
      }, NOTION_CLOSE_MS);
      return;
    }

    setNotionTransition("open");
    clearTimers();

    try {
      sessionStorage.setItem(NOTION_RETURN_KEY, normalizedPath);
    } catch {}

    router.push("/notion");
  }, [isNotionRoute, normalizedPath, notionTransition, router, clearTimers]);

  return (
    <NotionToggleContext.Provider
      value={{ notionTransition, isNotionRoute, toggleNotion, consumeSuppressRouteEnter }}
    >
      {children}
    </NotionToggleContext.Provider>
  );
}

export function useNotionToggle() {
  const ctx = useContext(NotionToggleContext);
  if (!ctx) {
    throw new Error("useNotionToggle debe usarse dentro de NotionToggleProvider");
  }
  return ctx;
}
