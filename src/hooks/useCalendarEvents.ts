"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveEventsApi, resolveDataPath } from "@/utils/api";

export type CalendarEvent = { id?: string; title: string; date: string };

type Updater = CalendarEvent[] | ((prev: CalendarEvent[]) => CalendarEvent[]);

export function useCalendarEvents() {
  const EVENTS_API = resolveEventsApi();
  const EVENTS_FALLBACK = resolveDataPath("/data/events.json");
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const persistEvents = useCallback((updater: Updater) => {
    setEvents((prev) => {
      const next = typeof updater === "function" ? (updater as (prev: CalendarEvent[]) => CalendarEvent[])(prev) : updater;
      return next;
    });
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const response = await fetch(EVENTS_API, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        persistEvents(Array.isArray(data) ? data : []);
        return;
      }
    } catch {
      // ignore and try fallback
    }
    try {
      const res = await fetch(EVENTS_FALLBACK, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        persistEvents(Array.isArray(data) ? data : []);
        return;
      }
    } catch {
      // ignore
    }
    persistEvents([]);
  }, [EVENTS_API, EVENTS_FALLBACK, persistEvents]);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  const addEvent = useCallback(
    async (title: string, date: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const res = await fetch(EVENTS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed, date }),
        });
        if (!res.ok) {
          throw new Error(`Error ${res.status}`);
        }
        const data = await res.json();
        persistEvents(Array.isArray(data) ? data : []);
      } catch (err) {
        throw err;
      }
    },
    [persistEvents, EVENTS_API]
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(EVENTS_API, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          throw new Error(`Error ${res.status}`);
        }
        const data = await res.json();
        persistEvents(Array.isArray(data) ? data : []);
      } catch (err) {
        throw err;
      }
    },
    [persistEvents, EVENTS_API]
  );

  return { events, refreshEvents, addEvent, deleteEvent };
}
