"use client";

import { ReactNode, createContext, useContext, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTicketLookup, TicketLookupTicket } from "@/hooks/useTicketLookup";
import { useTicketsContext } from "@/contexts/TicketsContext";

export type TicketLookupContextValue = {
  open: (rect?: DOMRect | null) => void;
  close: () => void;
  syncTickets: (tickets: TicketLookupTicket[]) => void;
};

const TicketLookupContext = createContext<TicketLookupContextValue | null>(null);

export function TicketLookupProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const defaultHandler = useCallback((ticketNumber: string) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("ticket-lookup", ticketNumber);
      window.dispatchEvent(new CustomEvent("ticket-lookup:selected", { detail: ticketNumber }));
    }
    router.push("/tickets");
  }, [router]);

  const submitHandler = useCallback((ticketNumber: string) => {
    setTimeout(() => {
      defaultHandler(ticketNumber);
    }, 0);
  }, [defaultHandler]);

  const { tickets } = useTicketsContext();
  const { openLookup, closeLookup, lookupOverlay, syncTickets } = useTicketLookup({ tickets, onSubmit: submitHandler });

  const value = useMemo(
    () => ({
      open: openLookup,
      close: closeLookup,
      syncTickets,
    }),
    [openLookup, closeLookup, syncTickets]
  );

  return (
    <TicketLookupContext.Provider value={value}>
      {children}
      {lookupOverlay}
    </TicketLookupContext.Provider>
  );
}

export function useTicketLookupContext() {
  return useContext(TicketLookupContext);
}
