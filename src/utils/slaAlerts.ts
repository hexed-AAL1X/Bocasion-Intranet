export type SlaSeverity = "critico" | "alta" | "media" | "baja";

export type SlaAlert = {
  id: string;
  ticketNumber: number | string;
  title: string;
  description: string;
  severity: SlaSeverity;
  source: string;
  minutesAgo: number;
  ageDays: number;
  tags: string[];
};

export type TicketLike = Record<string, unknown>;

export const SLA_THRESHOLDS = {
  critico: 5,
  alta: 3,
  media: 1,
} as const;

export const SLA_SEVERITY_COPY: Record<SlaSeverity, string> = {
  critico: "Se recomienda priorizar inmediatamente este ticket.",
  alta: "Requiere acción en las próximas horas para evitar escalamiento.",
  media: "Realiza seguimiento pronto para cumplir el SLA.",
  baja: "Dentro del rango esperado, monitorea su avance.",
};

const SEVERITY_RANK: Record<SlaSeverity, number> = {
  critico: 3,
  alta: 2,
  media: 1,
  baja: 0,
};

const normalizeEstado = (value: unknown) =>
  `${value ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const parseDateValue = (value: unknown): Date | null => {
  if (value === undefined || value === null || `${value}`.trim() === "") return null;
  const normalized = `${value}`.includes("T") ? `${value}` : `${value}`.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function getTicketNumber(ticket: TicketLike): number | string | null {
  const raw = ticket["Nº ticket"] ?? ticket.ticket_id ?? ticket["ticket_id"];
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return null;
  return typeof raw === "number" ? raw : `${raw}`.trim();
}

export function getRegistrationDate(ticket: TicketLike): Date | null {
  return parseDateValue(ticket["F. Registro"] ?? ticket.fecha_registro ?? ticket["fecha_registro"]);
}

export function getResponseDate(ticket: TicketLike): Date | null {
  const explicit =
    ticket["fecha_respuesta"] ??
    ticket.fecha_respuesta ??
    ticket["F. Alta"];
  const parsed = parseDateValue(explicit);
  if (!parsed) return null;

  const registro = getRegistrationDate(ticket);
  if (registro && parsed.getTime() === registro.getTime()) {
    return null;
  }
  return parsed;
}

export function isTicketPendingForSla(ticket: TicketLike): boolean {
  if (getTicketNumber(ticket) === null) return false;
  if (!getRegistrationDate(ticket)) return false;

  const estado = normalizeEstado(ticket.Estado ?? ticket.estado);
  if (/(cerrad|solucion|entregad|resuelt|finaliz|complet)/.test(estado)) {
    return false;
  }
  if (getResponseDate(ticket)) {
    return false;
  }
  return true;
}

export function resolveSlaSeverity(ageDays: number): SlaSeverity {
  if (ageDays >= SLA_THRESHOLDS.critico) return "critico";
  if (ageDays >= SLA_THRESHOLDS.alta) return "alta";
  if (ageDays >= SLA_THRESHOLDS.media) return "media";
  return "baja";
}

export function computeAgeDays(ticket: TicketLike, nowMs: number): number {
  const dias = ticket["Días"] ?? ticket.dias;
  if (typeof dias === "number" && Number.isFinite(dias)) {
    return Math.max(dias, 0);
  }
  const registro = getRegistrationDate(ticket);
  if (!registro) return 0;
  return Math.max(Math.floor((nowMs - registro.getTime()) / (1000 * 60 * 60 * 24)), 0);
}

export function buildSlaAlerts(
  tickets: TicketLike[],
  nowMs = Date.now(),
  limit = 20
): SlaAlert[] {
  return tickets
    .filter(isTicketPendingForSla)
    .map((ticket) => {
      const ticketNumber = getTicketNumber(ticket)!;
      const ageDays = computeAgeDays(ticket, nowMs);
      const severity = resolveSlaSeverity(ageDays);
      const registro = getRegistrationDate(ticket)!;
      const minutesAgo = Math.max(Math.floor((nowMs - registro.getTime()) / (1000 * 60)), 0);
      const incidencia = `${ticket.Incidencia ?? ticket.descripcion_detallada ?? ticket.motivo ?? ""}`;
      const contacto = `${ticket.Contacto ?? ticket.contacto ?? ""}`;
      const estado = `${ticket.Estado ?? ticket.estado ?? "Sin estado"}`;
      const responsable = `${ticket["Usuario a Cargo"] ?? ticket.responsable ?? "Sin asignar"}`;

      return {
        id: `${ticketNumber}`,
        ticketNumber,
        title: `Ticket #${ticketNumber}`,
        description: incidencia.slice(0, 140) || "Sin descripción",
        severity,
        source: contacto ? `Cliente: ${contacto}` : "Ticket interno",
        minutesAgo,
        ageDays,
        tags: [estado, responsable].filter(Boolean),
      };
    })
    .sort((a, b) => {
      if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      }
      return b.ageDays - a.ageDays;
    })
    .slice(0, limit);
}

export function countUrgentSlaAlerts(alerts: SlaAlert[]): number {
  return alerts.filter((alert) => alert.severity === "critico" || alert.severity === "alta").length;
}
