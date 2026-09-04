"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { resolveTicketsApi, resolveDataPath } from "@/utils/api";

/** Filas JSON heterogéneas (API / Excel). */
export type TicketRecord = Record<string, any>;

type TicketsContextValue = {
  tickets: TicketRecord[];
  loading: boolean;
  error: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  setTickets: (next: TicketRecord[] | ((prev: TicketRecord[]) => TicketRecord[])) => void;
};

const TicketsContext = createContext<TicketsContextValue | null>(null);

const API = resolveTicketsApi();
const FALLBACK_DATA = resolveDataPath("/data/tickets.json");

async function fetchTickets(): Promise<TicketRecord[]> {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data as TicketRecord[];
    }
  } catch {
    // ignore and fallback
  }
  try {
    const res = await fetch(FALLBACK_DATA, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data as TicketRecord[];
    }
  } catch {
    // ignore
  }
  return [];
}

type TicketsProviderProps = {
  children: React.ReactNode;
  initialTickets?: TicketRecord[];
  autoRefreshMs?: number;
};

export function TicketsProvider({
  children,
  initialTickets = [],
  autoRefreshMs = 60_000,
}: TicketsProviderProps) {
  const [tickets, setTicketsState] = useState<TicketRecord[]>(initialTickets);
  const [loading, setLoading] = useState(initialTickets.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchTickets();
      setTicketsState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar los tickets");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (initialTickets.length === 0) {
      void refresh();
    }
  }, [initialTickets.length, refresh]);

  useEffect(() => {
    if (!autoRefreshMs) return;
    const id = setInterval(() => {
      void refresh({ silent: true });
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, refresh]);

  const setTickets = useCallback(
    (next: TicketRecord[] | ((prev: TicketRecord[]) => TicketRecord[])) => {
      setTicketsState((prev) => {
        const resolved = typeof next === "function" ? (next as (prev: TicketRecord[]) => TicketRecord[])(prev) : next;
        return Array.isArray(resolved) ? resolved : prev;
      });
    },
    []
  );

  const value = useMemo(
    () => ({
      tickets,
      loading,
      error,
      refresh,
      setTickets,
    }),
    [tickets, loading, error, refresh, setTickets]
  );

  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>;
}

export function useTicketsContext() {
  const ctx = useContext(TicketsContext);
  if (!ctx) {
    throw new Error("TicketsProvider is required");
  }
  return ctx;
}
