"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resolveNotionTabsApi } from "@/utils/api";

export type NotionTab = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  /** Tab recibido por invitación (pestaña del owner en tu lista) */
  isShared?: boolean;
  sharedFrom?: string;
  /** Pestaña fijada: aparece primero; el arrastre solo reordena entre fijadas */
  pinned?: boolean;
};

const API_ENDPOINT = resolveNotionTabsApi();

const endpointForUser = (userId?: string) =>
  userId ? `${API_ENDPOINT}?userId=${encodeURIComponent(userId)}` : API_ENDPOINT;

function applyData(
  data: { tabs?: unknown; trash?: unknown },
  setTabs: Dispatch<SetStateAction<NotionTab[]>>,
  setTrash: Dispatch<SetStateAction<NotionTab[]>>,
) {
  const dedupe = (list: unknown): NotionTab[] => {
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    return (list as NotionTab[]).filter((tab) => {
      if (!tab?.id || seen.has(tab.id)) return false;
      seen.add(tab.id);
      return true;
    });
  };
  setTabs(dedupe(data.tabs));
  setTrash(dedupe(data.trash));
}

export function useNotionTabs(userId?: string) {
  const [tabs, setTabs] = useState<NotionTab[]>([]);
  const [trash, setTrash] = useState<NotionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const creatingTabRef = useRef(false);

  const refreshTabs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (!userId) { setLoading(false); return; }
      const response = await fetch(endpointForUser(userId), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("No se pudieron cargar las pestañas");
      }
      const data = await response.json();
      applyData(data, setTabs, setTrash);
      setActiveTabId((current) => current || data.activeTabId || (Array.isArray(data.tabs) ? data.tabs[0]?.id : "") || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refreshTabs();
  }, [refreshTabs]);

  // Escuchar evento global para refrescar tabs (ej. después de aceptar invitación)
  useEffect(() => {
    const handler = () => refreshTabs();
    window.addEventListener("notion-tabs-updated", handler);
    return () => window.removeEventListener("notion-tabs-updated", handler);
  }, [refreshTabs]);

  const createTab = useCallback(async (title?: string) => {
    if (creatingTabRef.current) return null;
    creatingTabRef.current = true;
    try {
      const response = await fetch(endpointForUser(userId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(`Error ${response.status}`);
      const data = await response.json();
      applyData(data, setTabs, setTrash);
      const nextTabs = Array.isArray(data.tabs) ? data.tabs : [];
      setActiveTabId(data.activeTabId || nextTabs[nextTabs.length - 1]?.id || "");
      return data;
    } finally {
      creatingTabRef.current = false;
    }
  }, [userId]);

  const renameTab = useCallback(async (id: string, title: string) => {
    const response = await fetch(endpointForUser(userId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    return data;
  }, [userId]);

  const deleteTab = useCallback(async (id: string) => {
    const response = await fetch(endpointForUser(userId), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    const nextTabs = Array.isArray(data.tabs) ? data.tabs : [];
    setActiveTabId((current) => current === id ? data.activeTabId || nextTabs[0]?.id || "" : current);
    return data;
  }, [userId]);

  const restoreTab = useCallback(async (id: string) => {
    const response = await fetch(endpointForUser(userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", id }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    setActiveTabId(data.activeTabId || id);
    return data;
  }, [userId]);

  const permanentDeleteTab = useCallback(async (id: string) => {
    const response = await fetch(endpointForUser(userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "permanentDelete", id }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    return data;
  }, [userId]);

  const reorderTabs = useCallback(async (tabIds: string[]) => {
    const response = await fetch(endpointForUser(userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", tabIds }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    return data;
  }, [userId]);

  const duplicateTab = useCallback(async (sourceTabId: string) => {
    const response = await fetch(endpointForUser(userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "duplicate", sourceTabId }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    const nextActive = typeof data.activeTabId === "string" ? data.activeTabId : "";
    if (nextActive) setActiveTabId(nextActive);
    return data;
  }, [userId]);

  const setTabPinned = useCallback(async (id: string, pinned: boolean) => {
    const response = await fetch(endpointForUser(userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setPinned", id, pinned }),
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    const data = await response.json();
    applyData(data, setTabs, setTrash);
    return data;
  }, [userId]);

  return {
    tabs, trash, activeTabId, setActiveTabId,
    loading, error,
    refreshTabs, createTab, renameTab, deleteTab,
    restoreTab, permanentDeleteTab,
    reorderTabs, duplicateTab,
    setTabPinned,
  };
}
