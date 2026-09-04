"use client";

import { useEffect, useMemo, useState } from "react";
import { useTicketsContext } from "@/contexts/TicketsContext";
import { buildSlaAlerts, countUrgentSlaAlerts, type SlaAlert } from "@/utils/slaAlerts";

export function useSlaAlerts(limit = 20) {
  const { tickets, loading } = useTicketsContext();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const alerts = useMemo(() => buildSlaAlerts(tickets, nowMs, limit), [tickets, nowMs, limit]);
  const urgentCount = useMemo(() => countUrgentSlaAlerts(alerts), [alerts]);

  return {
    alerts,
    loading,
    pendingCount: alerts.length,
    urgentCount,
  };
}

export type { SlaAlert };
