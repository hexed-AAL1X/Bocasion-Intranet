import { useState } from "react";
import { useUiPrefs } from "@/contexts/UiPrefsContext";

/**
 * Estado de shell compartido por todas las páginas:
 * notificaciones, configuración y preferencias de UI.
 */
export function usePageShell() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();

  return {
    showNotifications, setShowNotifications,
    showSettings,      setShowSettings,
    darkMode,          setDarkMode,
    sidebarRight,      setSidebarRight,
    collapsed,         setCollapsed,
  };
}
