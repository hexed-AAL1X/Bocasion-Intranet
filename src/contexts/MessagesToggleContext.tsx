"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type MessagesToggleContextValue = {
  showMessages: boolean;
  setShowMessages: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleMessages: () => void;
};

const MessagesToggleContext = createContext<MessagesToggleContextValue | null>(null);

export function MessagesToggleProvider({ children }: { children: ReactNode }) {
  const [showMessages, setShowMessages] = useState(false);

  const toggleMessages = useCallback(() => {
    setShowMessages((prev) => !prev);
  }, []);

  return (
    <MessagesToggleContext.Provider value={{ showMessages, setShowMessages, toggleMessages }}>
      {children}
    </MessagesToggleContext.Provider>
  );
}

export function useMessagesToggle() {
  const ctx = useContext(MessagesToggleContext);
  if (!ctx) {
    throw new Error("useMessagesToggle debe usarse dentro de MessagesToggleProvider");
  }
  return ctx;
}
