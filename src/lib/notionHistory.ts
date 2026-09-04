export type NotionRevisionKind = "auto" | "manual" | "pre_destructive";

export type NotionRevision = {
  id: string;
  tabId: string;
  revisionNum: number;
  userId: string;
  userName: string;
  kind: NotionRevisionKind;
  label: string;
  pinned: boolean;
  rowCount: number;
  contentHash: string;
  createdAt: string;
  tasks?: Record<string, unknown>[];
  columns?: { baseColumns: unknown[]; customColumns: unknown[] };
};

export type NotionAuditEntry = {
  id: number;
  tabId: string;
  userId: string;
  userName: string;
  action: string;
  summary: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};

export type NotionHistoryData = {
  tabTitles: Record<string, string>;
  revisions: NotionRevision[];
  audit: NotionAuditEntry[];
};

export type HistoryUserMeta = {
  userId: string;
  userName: string;
};

export function historyMetaFields(meta?: HistoryUserMeta | null): Record<string, string> {
  if (!meta?.userId) return {};
  return {
    _historyUserId: meta.userId,
    _historyUserName: meta.userName || "",
  };
}

export function formatHistoryRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  const stamp = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(",", " @");

  if (diffMin < 1) return `ahora · ${stamp}`;
  if (diffMin < 60) return `hace ${diffMin} min · ${stamp}`;
  if (diffHr < 24) {
    const mins = diffMin % 60;
    const rel = mins > 0 ? `hace ${diffHr} h ${mins} min` : `hace ${diffHr} h`;
    return `${rel} · ${stamp}`;
  }
  if (diffDay < 7) return `hace ${diffDay} d · ${stamp}`;
  if (diffDay < 30) return `hace ${Math.floor(diffDay / 7)} sem · ${stamp}`;
  return stamp;
}

export function revisionKindLabel(kind: NotionRevisionKind): string {
  switch (kind) {
    case "manual":
      return "Revisión manual";
    case "pre_destructive":
      return "Copia de seguridad";
    case "auto":
    default:
      return "Revisión automática";
  }
}

export function shouldCreatePreDeleteRevision(deleteCount: number, totalRows: number): boolean {
  if (deleteCount >= 3) return true;
  if (totalRows > 0 && deleteCount / totalRows >= 0.3) return true;
  return false;
}
