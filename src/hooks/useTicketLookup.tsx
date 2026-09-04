"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ticketStyles from "@/app/tickets/page.module.css";
import { resolveTicketsApi, resolveDataPath } from "@/utils/api";

const API = resolveTicketsApi();
const FALLBACK_DATA = resolveDataPath("/data/tickets.json");

export type TicketLookupTicket = Record<string, string | number | null | undefined> & {
  "Nº ticket"?: number | string;
  "F. Registro"?: string;
};

type UseTicketLookupOptions = {
  tickets?: TicketLookupTicket[];
  attributes?: string[];
  onSubmit?: (ticketNumber: string) => void;
};

type Anchor = { top: number; left: number; width: number } | null;

const DEFAULT_ATTRIBUTES = [
  "Nº ticket",
  "Incidencia",
  "Estado",
  "Usuario a Cargo",
  "Contacto",
  "F. Registro",
  "F. Alta",
  "Días",
];

async function fetchTicketsFromApi(): Promise<TicketLookupTicket[]> {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data as TicketLookupTicket[];
    }
  } catch {
    // ignore and fallback
  }
  try {
    const res = await fetch(FALLBACK_DATA, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data as TicketLookupTicket[];
    }
  } catch {
    // ignore
  }
  return [];
}

export function useTicketLookup({ tickets, attributes, onSubmit }: UseTicketLookupOptions = {}) {
  const [apiDataset, setApiDataset] = useState<TicketLookupTicket[]>([]);
  const [loading, setLoading] = useState(!tickets);
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<Anchor>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dataset = tickets ?? apiDataset;

  useEffect(() => {
    let active = true;
    const run = () => {
      if (!active) return;
      if (tickets) {
        setLoading(false);
        return;
      }
      setLoading(true);
      fetchTicketsFromApi().then((data) => {
        if (!active) return;
        setApiDataset(data);
        setLoading(false);
      });
    };
    const id = window.setTimeout(run, 0);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [tickets]);

  const normalizedAttributes = attributes?.length ? attributes : DEFAULT_ATTRIBUTES;

  const ticketNumberOptions = useMemo(() => {
    const seen = new Set<string>();
    dataset.forEach((ticket) => {
      const raw = ticket["Nº ticket"];
      if (raw === undefined || raw === null) return;
      const value = `${raw}`;
      if (value) seen.add(value);
    });
    return Array.from(seen).sort((a, b) => Number(a) - Number(b));
  }, [dataset]);

  const ticketPreview = useMemo(() => {
    if (!query) return null;
    return dataset.find((ticket) => `${ticket["Nº ticket"]}` === query) ?? null;
  }, [dataset, query]);

  const openLookup = useCallback(
    (rect?: DOMRect | null) => {
      if (rect) {
        const desiredWidth = Math.max(rect.width, 360);
        const maxLeft = typeof window !== "undefined" ? window.innerWidth - desiredWidth - 16 : rect.left;
        const left = Math.max(16, Math.min(rect.left, maxLeft));
        const top = rect.bottom + (typeof window !== "undefined" ? window.scrollY : 0) + 8;
        setAnchor({ top, left, width: desiredWidth });
      } else {
        setAnchor(null);
      }
      setShow(true);
      setQuery("");
    },
    []
  );

  const closeLookup = useCallback(() => {
    setShow(false);
    setAnchor(null);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!show) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLookup();
    };
    const handleClick = (e: MouseEvent) => {
      if (!cardRef.current) return;
      if (!cardRef.current.contains(e.target as Node)) {
        closeLookup();
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [show, closeLookup]);

  useEffect(() => {
    if (!show) return;
    const timeout = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timeout);
  }, [show]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query) return;
      onSubmit?.(query);
      closeLookup();
    },
    [query, onSubmit, closeLookup]
  );

  const lookupOverlay = !show ? null : (
    <div
      className={ticketStyles.lookupOverlay}
      style={{
        position: "fixed",
        top: anchor ? `${anchor.top}px` : "104px",
        left: anchor ? `${anchor.left}px` : "24px",
        width: anchor ? `${anchor.width}px` : "420px",
        zIndex: 999,
      }}
    >
      <div className={ticketStyles.lookupCard} ref={cardRef}>
        <div className={ticketStyles.lookupHeader}>
          <div>
            <h4>Buscar ticket</h4>
            <p>Ingresa el número exacto para ver sus detalles al instante.</p>
          </div>
          <button className={ticketStyles.closeLookup} onClick={closeLookup} aria-label="Cerrar buscador">
            ×
          </button>
        </div>
        <form className={ticketStyles.lookupForm} onSubmit={handleSubmit}>
          <label>
            <span>Nº ticket</span>
            <input
              ref={inputRef}
              list="ticketLookupOptions"
              className={ticketStyles.lookupInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej. 1543"
              inputMode="numeric"
            />
            <datalist id="ticketLookupOptions">
              {ticketNumberOptions.map((num) => (
                <option key={num} value={num} />
              ))}
            </datalist>
          </label>
          <div className={ticketStyles.lookupActions}>
            <button type="button" className={ticketStyles.ghostBtn} onClick={closeLookup}>
              Cancelar
            </button>
            <button type="submit" className={ticketStyles.primaryBtn} disabled={!query}>
              Buscar
            </button>
          </div>
        </form>
        <div className={ticketStyles.lookupResult}>
          {loading ? (
            <p className={ticketStyles.lookupEmpty}>Cargando tickets…</p>
          ) : query && ticketPreview ? (
            <div className={ticketStyles.lookupPreview}>
              {normalizedAttributes.map((attr) => (
                <div key={attr} className={ticketStyles.lookupPreviewRow}>
                  <span>{attr}</span>
                  <strong>{ticketPreview?.[attr] ?? "-"}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className={ticketStyles.lookupEmpty}>Introduce un número válido para ver la información.</p>
          )}
        </div>
      </div>
    </div>
  );

  const syncTickets = useCallback((list: TicketLookupTicket[]) => {
    setApiDataset(list);
    setLoading(false);
  }, []);

  return {
    openLookup,
    closeLookup,
    lookupOverlay,
    syncTickets,
  };
}
