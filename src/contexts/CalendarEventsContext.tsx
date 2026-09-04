"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import type { CalendarEvent } from "@/hooks/useCalendarEvents";

type CalendarEventsContextValue = {
  events: CalendarEvent[];
  refreshEvents: () => Promise<void>;
  addEvent: (title: string, date: string) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
};

const CalendarEventsContext = createContext<CalendarEventsContextValue | undefined>(undefined);

export function CalendarEventsProvider({ children }: { children: ReactNode }) {
  const { events, refreshEvents, addEvent, deleteEvent } = useCalendarEvents();
  return (
    <CalendarEventsContext.Provider value={{ events, refreshEvents, addEvent, deleteEvent }}>
      {children}
    </CalendarEventsContext.Provider>
  );
}

export function useCalendarEventsContext() {
  const context = useContext(CalendarEventsContext);
  if (!context) throw new Error("useCalendarEventsContext must be used within CalendarEventsProvider");
  return context;
}
