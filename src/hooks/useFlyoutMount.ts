"use client";

import { useEffect, useState } from "react";

const DEFAULT_MS = 400;

export function useFlyoutMount(show: boolean, durationMs = DEFAULT_MS) {
  const [mounted, setMounted] = useState(show);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (show) {
      setMounted(true);
      setExiting(false);
      return;
    }

    if (!mounted) return;

    setExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [show, mounted, durationMs]);

  return { mounted, exiting };
}
