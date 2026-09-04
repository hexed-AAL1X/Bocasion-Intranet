"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type CalendarToggleContextValue = {
  showCalendar: boolean;
  setShowCalendar: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleCalendar: () => void;
};

const CalendarToggleContext = createContext<CalendarToggleContextValue | null>(null);

export function CalendarToggleProvider({ children }: { children: ReactNode }) {
  const [showCalendar, setShowCalendar] = useState(false);

  const toggleCalendar = useCallback(() => {
    setShowCalendar((prev) => !prev);
  }, []);

  return (
    <CalendarToggleContext.Provider value={{ showCalendar, setShowCalendar, toggleCalendar }}>
      {children}
    </CalendarToggleContext.Provider>
  );
}

export function useCalendarToggle() {
  const ctx = useContext(CalendarToggleContext);
  if (!ctx) {
    throw new Error("useCalendarToggle debe usarse dentro de CalendarToggleProvider");
  }
  return ctx;
}
