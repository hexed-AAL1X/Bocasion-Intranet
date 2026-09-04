"use client";

import { useCallback, useState } from "react";
import type { NotionAuditEntry, NotionHistoryData, NotionRevision } from "@/lib/notionHistory";
import { resolveNotionHistoryApi } from "@/utils/api";

const API = resolveNotionHistoryApi();

type HistoryAction =
  | "create_revision"
  | "stable_checkpoint"
  | "pre_bulk_delete"
  | "apply_revision"
  | "pin_revision"
  | "restore_latest";

export function useNotionHistory(userId?: string, userName?: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NotionHistoryData | null>(null);

  const endpoint = useCallback(
    (tabId?: string, revisionId?: string) => {
      const params = new URLSearchParams({ userId: userId || "" });
      if (tabId) params.set("tabId", tabId);
      if (revisionId) params.set("revisionId", revisionId);
      return `${API}?${params.toString()}`;
    },
    [userId],
  );

  const refresh = useCallback(
    async (tabId?: string) => {
      if (!userId) return null;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(endpoint(tabId), { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as NotionHistoryData;
        setData(json);
        return json;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error cargando historial";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, userId],
  );

  const postAction = useCallback(
    async (action: HistoryAction, tabId: string, extra: Record<string, unknown> = {}) => {
      if (!userId) throw new Error("Usuario no autenticado");
      const res = await fetch(`${API}?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, tabId, userName: userName || "", ...extra }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `Error ${res.status}`);
      }
      return res.json();
    },
    [userId, userName],
  );

  const createManualRevision = useCallback(
    async (tabId: string, label = "Revisión manual") => {
      const result = await postAction("create_revision", tabId, { label });
      await refresh(tabId);
      return result as { revision?: NotionRevision; skipped?: boolean };
    },
    [postAction, refresh],
  );

  const createStableCheckpoint = useCallback(
    async (tabId: string) => {
      const result = await postAction("stable_checkpoint", tabId);
      if (!(result as { skipped?: boolean }).skipped) {
        await refresh(tabId);
      }
      return result;
    },
    [postAction, refresh],
  );

  const createPreBulkDeleteRevision = useCallback(
    async (tabId: string, beforeCount: number, deleteCount: number) => {
      const result = await postAction("pre_bulk_delete", tabId, { beforeCount, deleteCount });
      await refresh(tabId);
      return result;
    },
    [postAction, refresh],
  );

  const applyRevision = useCallback(
    async (tabId: string, revisionId: string) => {
      const result = await postAction("apply_revision", tabId, { revisionId });
      await refresh(tabId);
      return result as { tasks: unknown[]; columns: { baseColumns: unknown[]; customColumns: unknown[] } };
    },
    [postAction, refresh],
  );

  const restoreLatestRevision = useCallback(
    async (tabId: string) => {
      const result = await postAction("restore_latest", tabId);
      await refresh(tabId);
      return result as { restored?: boolean; tasks?: unknown[]; columns?: { baseColumns: unknown[]; customColumns: unknown[] } };
    },
    [postAction, refresh],
  );

  const getRevision = useCallback(
    async (tabId: string, revisionId: string) => {
      const res = await fetch(endpoint(tabId, revisionId), { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      return (await res.json()) as NotionRevision;
    },
    [endpoint],
  );

  return {
    data,
    loading,
    error,
    refresh,
    createManualRevision,
    createStableCheckpoint,
    createPreBulkDeleteRevision,
    applyRevision,
    restoreLatestRevision,
    getRevision,
  };
}

export type { NotionAuditEntry, NotionRevision, NotionHistoryData };
