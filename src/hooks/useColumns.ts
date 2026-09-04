"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { historyMetaFields, type HistoryUserMeta } from "@/lib/notionHistory";
import { resolveColumnsApi } from "@/utils/api";

export type Column = {
  id?: string;
  title: string;
  savedTitle: string;
  type: string;
  icon?: ReactNode;
  hidden: boolean;
  pinned: boolean;
  fit: boolean;
  filter: boolean;
  sort: string;
  group: boolean;
  calculate: string;
  options?: string[];
  optionColors?: Record<string, string>;
  hiddenOptions?: string[];
  width?: number;
  fieldKey?: string;
  relationSource?: string;
  previousIndex?: number;
};

export type ColumnsData = {
  baseColumns: Column[];
  customColumns: Column[];
};

const API_ENDPOINT = resolveColumnsApi();

const endpointForTab = (tabId?: string) => `${API_ENDPOINT}?tabId=${encodeURIComponent(tabId || "")}`;

const normalizeId = (type: string, index: number, scope: "base" | "custom") =>
  `${scope}_${type.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "column"}_${index + 1}`;

const defaultStatusOptions = ["Sin empezar", "Listo", "Completado"];

const defaultStatusColors: Record<string, string> = {
  "Sin empezar": "#9CA3AF",  // Gray
  "Listo": "#10B981",        // Green
  "Completado": "#3B82F6",   // Blue
};

const normalizeColumns = (columns: Column[], scope: "base" | "custom") =>
  columns.map((column, index) => ({
    ...column,
    id: column.id || normalizeId(column.type, index, scope),
    options: Array.isArray(column.options) && column.options.length > 0 
      ? column.options 
      : column.type === "Estado" 
        ? [...defaultStatusOptions] 
        : [],
    optionColors: column.type === "Estado" && (!column.optionColors || Object.keys(column.optionColors).length === 0)
      ? { ...defaultStatusColors }
      : column.optionColors || {},
  }));

export function useColumns(tabId?: string, historyMeta?: HistoryUserMeta) {
  const [baseColumns, setBaseColumns] = useState<Column[]>([]);
  const [customColumns, setCustomColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedForTabId, setLoadedForTabId] = useState<string | undefined>(undefined);
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  const applyColumns = useCallback((data: ColumnsData, forTabId: string) => {
    if (forTabId !== tabIdRef.current) return;
    setBaseColumns(normalizeColumns(Array.isArray(data.baseColumns) ? data.baseColumns : [], "base"));
    setCustomColumns(normalizeColumns(Array.isArray(data.customColumns) ? data.customColumns : [], "custom"));
  }, []);

  const refreshColumns = useCallback(async () => {
    const requestTabId = tabId;
    try {
      setLoading(true);
      setError(null);
      if (!requestTabId) return;
      const response = await fetch(endpointForTab(requestTabId), { cache: "no-store" });
      if (requestTabId !== tabIdRef.current) return;
      if (response.ok) {
        const data = await response.json();
        applyColumns(data, requestTabId);
      } else {
        setError("No se pudieron cargar las columnas");
      }
    } catch (err) {
      if (requestTabId === tabIdRef.current) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    } finally {
      if (requestTabId === tabIdRef.current) setLoading(false);
    }
  }, [applyColumns, tabId]);

  useEffect(() => {
    const requestTabId = tabId;
    let cancelled = false;
    setBaseColumns([]);
    setCustomColumns([]);
    setLoadedForTabId(undefined);
    setLoading(true);
    setError(null);
    if (!requestTabId) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(endpointForTab(requestTabId), { cache: "no-store" });
        if (cancelled || requestTabId !== tabIdRef.current) return;
        if (response.ok) {
          const data = await response.json();
          applyColumns(data, requestTabId);
          setLoadedForTabId(requestTabId);
        } else {
          setError("No se pudieron cargar las columnas");
        }
      } catch (err) {
        if (!cancelled && requestTabId === tabIdRef.current) {
          setError(err instanceof Error ? err.message : "Error desconocido");
        }
      } finally {
        if (!cancelled && requestTabId === tabIdRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyColumns, tabId]);

  const saveColumns = useCallback(async (base: Column[], custom: Column[]) => {
    const requestTabId = tabId;
    if (!requestTabId) throw new Error("tabId requerido");
    try {
      const baseWithoutIcon = base.map((col) => {
        const copy = { ...col };
        delete copy.icon;
        return copy;
      });
      const customWithoutIcon = custom.map((col) => {
        const copy = { ...col };
        delete copy.icon;
        return copy;
      });

      const res = await fetch(endpointForTab(requestTabId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseColumns: baseWithoutIcon,
          customColumns: customWithoutIcon,
          ...historyMetaFields(historyMeta),
        }),
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const data = await res.json();
      if (requestTabId === tabIdRef.current) {
        applyColumns(data, requestTabId);
      }
      return data;
    } catch (err) {
      throw err;
    }
  }, [applyColumns, tabId, historyMeta]);

  return { baseColumns, customColumns, loading, error, loadedForTabId, refreshColumns, saveColumns };
}
