"use client";

import { useCallback, useRef, useState } from "react";

export type SnackbarTone = "success" | "error" | "warning";

export type SnackbarItem = {
  id: number;
  message: string;
  tone: SnackbarTone;
  duration: number;
};

const DEFAULT_DURATION = 4500;

export function useSnackbar(defaultDuration = DEFAULT_DURATION) {
  const [snackbars, setSnackbars] = useState<SnackbarItem[]>([]);
  const idRef = useRef(0);

  const showSnackbar = useCallback(
    (message: string, tone: SnackbarTone, duration = defaultDuration) => {
      const id = idRef.current++;
      setSnackbars((prev) => [...prev, { id, message, tone, duration }]);
      window.setTimeout(() => {
        setSnackbars((prev) => prev.filter((s) => s.id !== id));
      }, duration);
    },
    [defaultDuration],
  );

  const dismissSnackbar = useCallback((id: number) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { snackbars, showSnackbar, dismissSnackbar };
}
