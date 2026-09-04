"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeNotionTasks, syncNotionTasksFromServer } from "@/lib/mergeNotionTasks";
import { historyMetaFields, type HistoryUserMeta } from "@/lib/notionHistory";
import { resolveTasksApi } from "@/utils/api";

export type Task = {
  id?: string;
  usuario: string;
  area: string;
  actividad: string;
  fecha: string;
  estado: string;
  [key: string]: unknown;
};

type Updater = Task[] | ((prev: Task[]) => Task[]);

const API_ENDPOINT = resolveTasksApi();

const endpointForTab = (tabId?: string) => `${API_ENDPOINT}?tabId=${encodeURIComponent(tabId || "")}`;

function asTaskList(data: unknown): Task[] {
  return Array.isArray(data) ? (data as Task[]) : [];
}

type ParsedTasksResponse = {
  tasks: Task[];
  updatedTask?: Task;
};

async function readTasksResponse(res: Response): Promise<ParsedTasksResponse> {
  const text = await res.text();
  if (!text.trim()) return { tasks: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Respuesta JSON inválida o truncada del servidor");
  }
  if (Array.isArray(data)) {
    return { tasks: asTaskList(data) };
  }
  if (data && typeof data === "object") {
    const payload = data as { tasks?: unknown; task?: unknown };
    const tasks = asTaskList(payload.tasks);
    const updatedTask =
      payload.task && typeof payload.task === "object" ? (payload.task as Task) : undefined;
    if (tasks.length || updatedTask) {
      return { tasks, updatedTask };
    }
  }
  return { tasks: [] };
}

export function useTasks(tabId?: string, historyMeta?: HistoryUserMeta) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedForTabId, setLoadedForTabId] = useState<string | undefined>(undefined);
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  const persistTasks = useCallback((updater: Updater, forTabId?: string) => {
    if (forTabId && forTabId !== tabIdRef.current) return;
    setTasks((prev) => {
      const next = typeof updater === "function" ? (updater as (prev: Task[]) => Task[])(prev) : updater;
      return next;
    });
  }, []);

  const mergeServerTasks = useCallback((prev: Task[], server: Task[]) => {
    return syncNotionTasksFromServer(prev, server) as Task[];
  }, []);

  const applyServerTasks = useCallback(
    (prev: Task[], parsed: ParsedTasksResponse) => {
      if (parsed.tasks.length > 0) {
        return mergeServerTasks(prev, parsed.tasks);
      }
      if (parsed.updatedTask?.id) {
        return mergeServerTasks(prev, [parsed.updatedTask]);
      }
      return prev;
    },
    [mergeServerTasks],
  );

  const refreshTasks = useCallback(async () => {
    const requestTabId = tabId;
    try {
      setLoading(true);
      setError(null);
      if (!requestTabId) {
        persistTasks([]);
        return;
      }
      const response = await fetch(endpointForTab(requestTabId), { cache: "no-store" });
      if (requestTabId !== tabIdRef.current) return;
      if (response.ok) {
        const parsed = await readTasksResponse(response);
        persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
        setLoadedForTabId(requestTabId);
      } else {
        setError("No se pudieron cargar las tareas");
      }
    } catch (err) {
      if (requestTabId === tabIdRef.current) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    } finally {
      if (requestTabId === tabIdRef.current) setLoading(false);
    }
  }, [applyServerTasks, persistTasks, tabId]);

  useEffect(() => {
    const requestTabId = tabId;
    let cancelled = false;
    setTasks([]);
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
          const parsed = await readTasksResponse(response);
          persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
          setLoadedForTabId(requestTabId);
        } else {
          setError(`No se pudieron cargar las tareas (${response.status})`);
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
  }, [applyServerTasks, persistTasks, tabId]);

  const addTask = useCallback(
    async (task: Task) => {
      const requestTabId = tabId;
      if (!requestTabId) throw new Error("tabId requerido");
      const now = new Date().toISOString();
      const taskWithTimestamp = { ...task, createdAt: now, updatedAt: now, ...historyMetaFields(historyMeta) };
      const res = await fetch(endpointForTab(requestTabId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskWithTimestamp),
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const parsed = await readTasksResponse(res);
      if (requestTabId === tabIdRef.current) {
        persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
      }
      return parsed;
    },
    [applyServerTasks, persistTasks, tabId, historyMeta],
  );

  const updateTask = useCallback(
    async (id: string, updates: Partial<Task>) => {
      const requestTabId = tabId;
      if (!requestTabId) throw new Error("tabId requerido");
      const now = new Date().toISOString();
      const updatesWithTimestamp = { ...updates, updatedAt: now, ...historyMetaFields(historyMeta) };
      const res = await fetch(endpointForTab(requestTabId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...updatesWithTimestamp }),
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const parsed = await readTasksResponse(res);
      if (requestTabId === tabIdRef.current) {
        persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
      }
      return parsed;
    },
    [applyServerTasks, persistTasks, tabId, historyMeta],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const requestTabId = tabId;
      if (!requestTabId) throw new Error("tabId requerido");
      const res = await fetch(endpointForTab(requestTabId), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...historyMetaFields(historyMeta) }),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Error ${res.status}`);
      }
      if (res.ok) {
        const parsed = await readTasksResponse(res);
        if (requestTabId === tabIdRef.current) {
          persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
        }
        return parsed;
      }
      if (requestTabId === tabIdRef.current) {
        await refreshTasks();
      }
      return { tasks: [] as Task[] };
    },
    [applyServerTasks, persistTasks, refreshTasks, tabId, historyMeta],
  );

  const reorderTasks = useCallback(
    async (orderedIds: string[]) => {
      const requestTabId = tabId;
      if (!requestTabId) throw new Error("tabId requerido");
      const ids = orderedIds.filter(Boolean);
      if (!ids.length) return [];
      const res = await fetch(endpointForTab(requestTabId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _reorder: ids, ...historyMetaFields(historyMeta) }),
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }
      const parsed = await readTasksResponse(res);
      if (requestTabId === tabIdRef.current) {
        persistTasks((prev) => applyServerTasks(prev, parsed), requestTabId);
      }
      return parsed;
    },
    [applyServerTasks, persistTasks, tabId, historyMeta],
  );

  const patchTaskLocal = useCallback((id: string, updates: Partial<Task>) => {
    if (!tabIdRef.current) return;
    persistTasks(
      (prev) => prev.map((task) => (task.id === id ? { ...task, ...updates } : task)),
      tabIdRef.current,
    );
  }, [persistTasks]);

  return { tasks, loading, error, loadedForTabId, refreshTasks, addTask, updateTask, deleteTask, reorderTasks, patchTaskLocal };
}
