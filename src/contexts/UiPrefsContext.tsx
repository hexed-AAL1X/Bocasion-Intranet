"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

type UiPrefsContextValue = {
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  sidebarRight: boolean;
  setSidebarRight: (value: boolean) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  prefsLoaded: boolean;
};

const defaultPrefs = { darkMode: false, sidebarRight: false, collapsed: false };
const PREFS_STORAGE_KEY = "ui-prefs";
const UiPrefsContext = createContext<UiPrefsContextValue | undefined>(undefined);
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(defaultPrefs.darkMode);
  const [sidebarRight, setSidebarRight] = useState(defaultPrefs.sidebarRight);
  const [collapsed, setCollapsed] = useState(defaultPrefs.collapsed);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(PREFS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<UiPrefsContextValue>;
        setDarkMode(parsed.darkMode ?? defaultPrefs.darkMode);
        setSidebarRight(parsed.sidebarRight ?? defaultPrefs.sidebarRight);
        setCollapsed(parsed.collapsed ?? defaultPrefs.collapsed);
      }
    } catch {
      // ignore invalid storage
    } finally {
      setPrefsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!prefsLoaded || typeof window === "undefined") return;
    const payload = JSON.stringify({ darkMode, sidebarRight, collapsed });
    window.localStorage.setItem(PREFS_STORAGE_KEY, payload);
  }, [prefsLoaded, darkMode, sidebarRight, collapsed]);

  // Marcar el body con data-dark para que elementos fuera del .page
  // (como el lookup overlay) puedan heredar las variables CSS correctas
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.dark = darkMode ? "true" : "false";
  }, [darkMode]);

  const value = useMemo(
    () => ({ darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed, prefsLoaded }),
    [darkMode, sidebarRight, collapsed, prefsLoaded]
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error("useUiPrefs must be used inside UiPrefsProvider");
  return ctx;
}
