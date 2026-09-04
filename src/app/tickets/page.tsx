"use client";

import { useEffect, useMemo, useState, useRef, useCallback, type ReactNode, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";
import {
  FiEdit2,
  FiTrash2,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiDownload,
  FiChevronDown,
  FiFileText,
  FiFile,
  FiLayers,
  FiUpload,
  FiPlus,
  FiFilter,
  FiX,
  FiRefreshCw,
} from "react-icons/fi";
import { poppins } from "@/fonts";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { EmptyState } from "../../components/EmptyState";
import { resolveTicketsApi, resolveNavasoftApi, resolveDataPath } from "@/utils/api";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { useTicketsContext, type TicketRecord } from "@/contexts/TicketsContext";
import { useAuthSession } from "@/components/AuthGate";

const SNACKBAR_DURATION = 4500;
const API = resolveTicketsApi();
const NAVASOFT_QUEUE = resolveNavasoftApi();
type Ticket = TicketRecord;
const DEFAULT_ESTADOS = ["Pendiente", "En desarrollo", "Solucionado", "Sin estado"];
const ESTADO_PALETTE = ["#2563EB", "#0EA5E9", "#10B981", "#F97316", "#D946EF", "#EC4899", "#14B8A6", "#F59E0B"];
const COLUMN_PREFERENCE = [
  "Nº ticket",
  "Motivo",
  "Incidencia",
  "Contacto",
  "Estado",
  "Usuario a Cargo",
  "F. Registro",
  "F. Alta",
  "Días",
  "Solución",
];
const FALLBACK_COLUMNS = [
  "Nº ticket",
  "Incidencia",
  "Estado",
  "Usuario a Cargo",
  "Contacto",
  "Días",
  "F. Alta",
  "F. Registro",
  "Solución",
];
type Snackbar = {
  id: number;
  message: string;
  tone: "success" | "error" | "warning";
  duration: number;
};

const normalizeColumnKey = (value: string) =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const sanitizeTextCell = (value: unknown) => {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
};

const normalizeEstadoKey = (value: string) =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const hexToRgba = (hex: string, alpha: number) => {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized.length === 3 ? sanitized.repeat(2) : sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const parseNumericCell = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const getRowValue = (row: Record<string, unknown>, ...candidates: string[]) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return row[candidate];
    }
    const target = normalizeColumnKey(candidate);
    const match = Object.keys(row).find((key) => normalizeColumnKey(key) === target);
    if (match) {
      return row[match];
    }
  }
  return undefined;
};

const parseDateCell = (value: unknown) => {
  const text = sanitizeTextCell(value);
  if (!text) return "";
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const getTicketSortTimestamp = (ticket: Ticket) => {
  const registro = ticket["F. Registro"] ? new Date(String(ticket["F. Registro"])) : null;
  const alta = ticket["F. Alta"] ? new Date(String(ticket["F. Alta"])) : null;
  const date =
    registro && !Number.isNaN(registro.getTime())
      ? registro
      : alta && !Number.isNaN(alta.getTime())
        ? alta
        : null;
  if (date) return date.getTime();
  const n = Number(ticket["Nº ticket"]);
  return Number.isFinite(n) ? n : 0;
};

const compareTicketsNewestFirst = (a: Ticket, b: Ticket) => getTicketSortTimestamp(b) - getTicketSortTimestamp(a);

const calculateDias = (fromIso?: string, toIso?: string) => {
  if (!fromIso) return 0;
  const start = new Date(fromIso);
  if (Number.isNaN(start.getTime())) return 0;
  const end = toIso ? new Date(toIso) : new Date();
  if (Number.isNaN(end.getTime())) return 0;
  const diff = Math.max(0, end.getTime() - start.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const COMPARABLE_FIELDS = [
  "F. Alta",
  "F. Registro",
  "Días",
  "Incidencia",
  "Solución",
  "Contacto",
  "Estado",
  "Usuario a Cargo",
  "Motivo",
  "Modulo",
  "Submodulo",
  "descripcion_detallada",
  "respuesta_detallada",
  "ticket_id",
  "fecha_registro",
  "fecha_respuesta",
  "motivo",
  "modulo",
  "submodulo",
  "responsable",
];

const snapshotValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return `${value}`;
};

const createComparableSnapshot = (ticket: Ticket) => {
  const snapshot: Record<string, unknown> = { "Nº ticket": ticket["Nº ticket"] };
  COMPARABLE_FIELDS.forEach((field) => {
    if (ticket[field] !== undefined) {
      snapshot[field] = ticket[field];
    }
  });
  return snapshot;
};

const ticketsAreEqual = (existing: Ticket | undefined, incoming: Ticket) => {
  if (!existing) return false;
  const prev = createComparableSnapshot(existing);
  const next = createComparableSnapshot({ ...existing, ...incoming });
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (snapshotValue(prev[key]) !== snapshotValue(next[key])) {
      return false;
    }
  }
  return true;
};

const normalizeImportedTicketRow = (row: Record<string, unknown>): Ticket | null => {
  const ticketNumber = parseNumericCell(getRowValue(row, "Nº ticket", "ticket_id", "id", "numero"));
  if (ticketNumber === null) return null;

  const contacto = sanitizeTextCell(getRowValue(row, "Contacto", "contacto"));
  const estado = sanitizeTextCell(getRowValue(row, "Estado", "estado")) || "sin estado";
  const responsable = sanitizeTextCell(getRowValue(row, "Usuario a Cargo", "responsable")) || "Sin asignar";
  const motivo = sanitizeTextCell(getRowValue(row, "Motivo", "motivo"));
  const modulo = sanitizeTextCell(getRowValue(row, "Módulo", "Modulo", "modulo"));
  const submodulo = sanitizeTextCell(getRowValue(row, "Submódulo", "Submodulo", "submodulo"));
  const descripcion = sanitizeTextCell(
    getRowValue(row, "Incidencia", "descripcion_detallada", "descripcion", "detalle")
  );
  const respuesta = sanitizeTextCell(getRowValue(row, "Solución", "respuesta_detallada", "respuesta"));
  const registroIso = parseDateCell(getRowValue(row, "F. Registro", "fecha_registro")) || new Date().toISOString();
  const altaIso = parseDateCell(getRowValue(row, "F. Alta", "fecha_respuesta")) || "";
  const diasCell = parseNumericCell(getRowValue(row, "Días", "dias"));
  const dias = diasCell ?? (altaIso ? calculateDias(registroIso, altaIso) : calculateDias(registroIso, registroIso));

  const normalized: Ticket = {
    ...(row as Ticket),
    "Nº ticket": ticketNumber,
    ticket_id: ticketNumber,
    Contacto: contacto,
    Estado: estado,
    Incidencia: descripcion || motivo || estado,
    "Solución": respuesta,
    "Usuario a Cargo": responsable,
    "F. Registro": registroIso,
    fecha_registro: registroIso,
    ...(altaIso
      ? {
          "F. Alta": altaIso,
          fecha_respuesta: altaIso,
        }
      : {}),
    "Días": dias,
    Motivo: motivo,
    modulo,
    Modulo: modulo,
    submodulo,
    Submodulo: submodulo,
    descripcion_detallada: descripcion,
    respuesta_detallada: respuesta,
  };

  return normalized;
};

export default function TicketsPage() {
  const auth = useAuthSession();

  const {
    tickets,
    setTickets,
  } = useTicketsContext();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();
  const [filters, setFilters] = useState({
    estado: "",
    contacto: "",
    usuario: "",
    motivo: "",
    modulo: "",
    submodulo: "",
    dateFrom: "",
    dateTo: "",
    diasMin: "",
    diasMax: "",
  });
  const [page, setPage] = useState(1);
  const [toolsPanel, setToolsPanel] = useState<null | "new" | "filters">(null);
  const newTicketTemplate = () => ({
    "F. Alta": "",
    "F. Registro": new Date().toISOString().slice(0, 16),
    "Días": 0,
    Incidencia: "",
    "Solución": "",
    "Nº ticket": "",
    Contacto: "",
    Estado: "pendiente",
    "Usuario a Cargo": "",
  });
  const [newTicket, setNewTicket] = useState<Ticket>(newTicketTemplate);
  const pageSize = 8;
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState({ estado: "", solucion: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [snackbars, setSnackbars] = useState<Snackbar[]>([]);
  const snackbarIdRef = useRef(0);
  const [pendingDelete, setPendingDelete] = useState<Ticket | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const excelMenuRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [navasoftUpdating, setNavasoftUpdating] = useState(false);
  const [navasoftProgress, setNavasoftProgress] = useState<string | null>(null);
  const [navasoftPanelOpen, setNavasoftPanelOpen] = useState(false);
  const [navasoftPanelSrc, setNavasoftPanelSrc] = useState<string | null>(null);
  const [highlightTicket, setHighlightTicket] = useState<string | null>(null);
  const snackbarIcons: Record<Snackbar["tone"], ReactNode> = {
    success: <FiCheckCircle />,
    error: <FiXCircle />,
    warning: <FiAlertTriangle />,
  };

  const showSnackbar = useCallback((message: string, tone: Snackbar["tone"], duration = SNACKBAR_DURATION) => {
    const id = snackbarIdRef.current++;
    setSnackbars((prev) => [...prev, { id, message, tone, duration }]);
    setTimeout(() => {
      setSnackbars((prev) => prev.filter((snack) => snack.id !== id));
    }, duration);
  }, []);

  const triggerImportDialog = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const importTicketBuffer = useCallback(
    async (buffer: ArrayBuffer, sourceLabel: string) => {
      try {
        const workbook = XLSX.read(buffer, { type: "array" });
        if (!workbook.SheetNames.length) {
          showSnackbar("El archivo no contiene hojas", "warning");
          return;
        }
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          showSnackbar("No se pudo leer la primera hoja", "warning");
          return;
        }
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
        const normalizedRows = rawRows
          .map((row) => normalizeImportedTicketRow(row))
          .filter((row): row is Ticket => row !== null);

        if (!normalizedRows.length) {
          showSnackbar("No se encontraron tickets válidos en el archivo", "warning");
          return;
        }

        let referenceTickets: Ticket[] = tickets;
        try {
          const latestRes = await fetch(API, { cache: "no-store" });
          if (latestRes.ok) {
            const latestData = await latestRes.json();
            if (Array.isArray(latestData)) {
              referenceTickets = latestData as Ticket[];
            }
          }
        } catch (syncError) {
          console.warn("No se pudo sincronizar antes de importar", syncError);
        }

        const existingMap = new Map(referenceTickets.map((ticket) => [`${ticket["Nº ticket"]}`, ticket]));
        const operations = new Map<string, { ticket: Ticket; op: "create" | "update" }>();
        let skippedRows = 0;

        normalizedRows.forEach((row) => {
          const key = `${row["Nº ticket"]}`.trim();
          if (!key) {
            skippedRows += 1;
            return;
          }
          const incoming: Ticket = { ...row, "Nº ticket": Number(key) };
          const existing = existingMap.get(key);
          if (!existing) {
            operations.set(key, { ticket: incoming, op: "create" });
            return;
          }

          const pending = operations.get(key)?.ticket;
          const reference = pending ?? existing;

          if (ticketsAreEqual(reference, incoming)) {
            if (operations.get(key)?.op === "create") {
              operations.set(key, { ticket: incoming, op: "create" });
            } else {
              operations.delete(key);
            }
            return;
          }

          operations.set(key, { ticket: { ...existing, ...incoming }, op: "update" });
        });

        const toPersist = Array.from(operations.values());
        if (!toPersist.length) {
          const unchanged = normalizedRows.length - skippedRows;
          showSnackbar(
            unchanged > 0 ? "Todos los tickets coincidían con la base" : "No se encontraron tickets válidos",
            "warning"
          );
          return;
        }

        const payload = toPersist.map((entry) => entry.ticket);
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.status === 409) {
          const info = await res.json().catch(() => null);
          const message = info?.error ?? "No se encontraron cambios";
          showSnackbar(message, "warning");
          return;
        }
        if (!res.ok) {
          throw new Error("No se pudo persistir la importación");
        }

        const data = await res.json();
        setTickets(data);

        const createdCount = toPersist.filter((entry) => entry.op === "create").length;
        const updatedCount = toPersist.length - createdCount;
        const unchangedCount = Math.max(normalizedRows.length - toPersist.length - skippedRows, 0);
        const firstOperation = toPersist[0]?.ticket["Nº ticket"];

        const parts: string[] = [];
        if (createdCount) {
          parts.push(`${createdCount} ticket${createdCount > 1 ? "s" : ""} importado${createdCount > 1 ? "s" : ""}`);
        }
        if (updatedCount) {
          parts.push(
            `${updatedCount} ticket${updatedCount > 1 ? "s" : ""} modificado${updatedCount > 1 ? "s" : ""}`
          );
        }
        if (unchangedCount) {
          parts.push(`${unchangedCount} sin cambios`);
        }
        if (skippedRows) {
          parts.push(`${skippedRows} inválido${skippedRows > 1 ? "s" : ""}`);
        }

        showSnackbar(`${sourceLabel}: ${parts.join(" · ") || "importación completada"}`, "success");
        setPage(1);
        if (firstOperation !== undefined) {
          setHighlightTicket(String(firstOperation));
        }
      } catch (error) {
        console.error("ticket import error", error);
        throw error;
      }
    },
    [tickets, setTickets, showSnackbar]
  );

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setImporting(true);
      try {
        await importTicketBuffer(await file.arrayBuffer(), file.name);
      } catch {
        showSnackbar("No se pudo importar el archivo", "error");
      } finally {
        event.target.value = "";
        setImporting(false);
      }
    },
    [importTicketBuffer, showSnackbar]
  );

  const handleNavasoftUpdate = useCallback(async () => {
    if (navasoftUpdating) return;
    setNavasoftUpdating(true);
    setNavasoftProgress("Solicitando sincronización…");
    try {
      const requestRes = await fetch(NAVASOFT_QUEUE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      if (!requestRes.ok) throw new Error("El servidor no aceptó la solicitud de sincronización");
      const requestData = (await requestRes.json()) as { job?: { id?: number } };
      const jobId = requestData.job?.id;
      if (!jobId) throw new Error("El servidor no devolvió un trabajo válido");

      const queueAbs =
        typeof window !== "undefined"
          ? new URL(NAVASOFT_QUEUE, window.location.href).href
          : NAVASOFT_QUEUE;
      const panel = new URL(resolveDataPath("/navasoft-panel.html"), window.location.href);
      panel.searchParams.set("embed", "1");
      panel.searchParams.set("job", String(jobId));
      panel.searchParams.set("queue", queueAbs);
      panel.searchParams.set("run", String(Date.now()));

      setNavasoftProgress("Sincronizando…");
      setNavasoftPanelSrc(panel.toString());
      setNavasoftPanelOpen(true);
    } catch (error) {
      console.error("navasoft update error", error);
      const message =
        error instanceof TypeError
          ? "No se pudo contactar al servidor de sincronización"
          : error instanceof Error
            ? error.message
            : "No se pudo actualizar desde Navasoft";
      setNavasoftProgress(null);
      showSnackbar(message, "error", 8000);
      setNavasoftUpdating(false);
    }
  }, [navasoftUpdating, showSnackbar]);

  useEffect(() => {
    const handleNavasoftMessage = async (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: string; rows?: unknown; message?: string };

      if (message.type === "navasoft-error") {
        setNavasoftUpdating(false);
        setNavasoftProgress(null);
        setNavasoftPanelOpen(false);
        setNavasoftPanelSrc(null);
        showSnackbar(message.message || "No se pudo sincronizar Navasoft", "error", 7000);
        return;
      }
      if (message.type === "navasoft-panel-finished") {
        window.setTimeout(() => {
          setNavasoftPanelOpen(false);
          setNavasoftPanelSrc(null);
        }, 300);
        return;
      }
      if (message.type !== "navasoft-tickets") return;

      if (!Array.isArray(message.rows)) {
        setNavasoftUpdating(false);
        showSnackbar("Navasoft no devolvió una lista válida de tickets", "error");
        return;
      }

      setNavasoftProgress("Guardando tickets…");
      try {
        const sheet = XLSX.utils.json_to_sheet(message.rows as Record<string, unknown>[]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, "Tickets");
        const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
        await importTicketBuffer(buffer, "Navasoft");
        setNavasoftProgress("Tickets actualizados");
      } catch (error) {
        console.error("navasoft persist error", error);
        setNavasoftProgress(null);
        showSnackbar("Navasoft terminó, pero no se pudieron guardar los tickets", "error", 7000);
      } finally {
        setNavasoftUpdating(false);
      }
    };

    window.addEventListener("message", handleNavasoftMessage);
    return () => window.removeEventListener("message", handleNavasoftMessage);
  }, [importTicketBuffer, showSnackbar]);

  const formatDate = useCallback((value?: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }, []);

  useEffect(() => {
    if (!excelMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!excelMenuRef.current) return;
      if (!excelMenuRef.current.contains(e.target as Node)) {
        setExcelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [excelMenuOpen]);

  const getDiasValue = (ticket: Ticket) => {
    if (!ticket) return "—";
    return ticket["Días"] ?? ticket["dias"] ?? "—";
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem("ticket-lookup");
    if (stored) {
      setHighlightTicket(stored);
      setPage(1);
      window.sessionStorage.removeItem("ticket-lookup");
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (!detail) return;
      setHighlightTicket(detail);
      setPage(1);
    };
    window.addEventListener("ticket-lookup:selected", handler as EventListener);
    return () => {
      window.removeEventListener("ticket-lookup:selected", handler as EventListener);
    };
  }, []);

  const attributes = useMemo(() => {
    if (!tickets.length) return FALLBACK_COLUMNS;
    const available = new Set<string>();
    tickets.forEach((ticket) => {
      Object.keys(ticket).forEach((key) => available.add(key));
    });
    const ordered: string[] = [];
    COLUMN_PREFERENCE.forEach((key) => {
      if (available.has(key)) {
        ordered.push(key);
      }
    });
    return ordered.length ? ordered : FALLBACK_COLUMNS;
  }, [tickets]);

  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const val = (t["Usuario a Cargo"] ?? "").toString().trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const estadoOptions = useMemo(() => {
    const map = new Map<string, string>();
    tickets.forEach((t) => {
      const raw = sanitizeTextCell(t.Estado ?? "");
      if (!raw) return;
      const key = normalizeEstadoKey(raw);
      if (!map.has(key)) {
        map.set(key, raw);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tickets]);

  const estadoChoices = estadoOptions.length ? estadoOptions : DEFAULT_ESTADOS;

  const estadoColorMap = useMemo(() => {
    const map: Record<string, { color: string; backgroundColor: string; borderColor: string }> = {};
    estadoChoices.forEach((estado, idx) => {
      const color = ESTADO_PALETTE[idx % ESTADO_PALETTE.length];
      map[normalizeEstadoKey(estado)] = {
        color,
        backgroundColor: hexToRgba(color, 0.15),
        borderColor: hexToRgba(color, 0.4),
      };
    });
    return map;
  }, [estadoChoices]);

  const getEstadoStyle = useCallback(
    (estado?: string) => {
      const fallback = { color: "#64748B", backgroundColor: "rgba(148, 163, 184, 0.18)", borderColor: "rgba(148, 163, 184, 0.4)" };
      if (!estado) return fallback;
      const key = normalizeEstadoKey(estado);
      return estadoColorMap[key] ?? fallback;
    },
    [estadoColorMap]
  );

  const motiveOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const val = (t.Motivo ?? t["motivo"] ?? "").toString().trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const moduleOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const val = (t.Modulo ?? t["modulo"] ?? "").toString().trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const submoduleOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const val = (t.Submodulo ?? t["submodulo"] ?? "").toString().trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      const estadoOk = filters.estado
        ? normalizeEstadoKey(t.Estado ?? "") === normalizeEstadoKey(filters.estado)
        : true;
      const contactoOk = filters.contacto ? (t.Contacto ?? "").toString().toLowerCase().includes(filters.contacto.toLowerCase()) : true;
      const usuarioOk = filters.usuario ? (t["Usuario a Cargo"] ?? "").toString().toLowerCase().includes(filters.usuario.toLowerCase()) : true;
      const motivoOk = filters.motivo ? (t.Motivo ?? t["motivo"] ?? "").toString().toLowerCase().includes(filters.motivo.toLowerCase()) : true;
      const moduloOk = filters.modulo ? (t.Modulo ?? t["modulo"] ?? "").toString().toLowerCase().includes(filters.modulo.toLowerCase()) : true;
      const submoduloOk = filters.submodulo
        ? (t.Submodulo ?? t["submodulo"] ?? "").toString().toLowerCase().includes(filters.submodulo.toLowerCase())
        : true;

      const diasVal = Number(t["Días"] ?? t["dias"] ?? 0);
      const diasMinOk = filters.diasMin !== "" ? diasVal >= Number(filters.diasMin) : true;
      const diasMaxOk = filters.diasMax !== "" ? diasVal <= Number(filters.diasMax) : true;

      const alta = t["F. Alta"] ? new Date(t["F. Alta"]) : null;
      const registro = t["F. Registro"] ? new Date(t["F. Registro"]) : null;
      const dateField = alta || registro;
      const fromOk = filters.dateFrom && dateField ? dateField >= new Date(filters.dateFrom) : true;
      const toOk = filters.dateTo && dateField ? dateField <= new Date(filters.dateTo) : true;

      return (
        estadoOk &&
        contactoOk &&
        usuarioOk &&
        motivoOk &&
        moduloOk &&
        submoduloOk &&
        diasMinOk &&
        diasMaxOk &&
        fromOk &&
        toOk
      );
    }).sort(compareTicketsNewestFirst);
  }, [tickets, filters]);

  const displayTickets = useMemo(() => {
    if (!highlightTicket) return filtered;
    const idx = filtered.findIndex((t) => `${t["Nº ticket"]}` === highlightTicket);
    if (idx === -1) return filtered;
    const match = filtered[idx];
    return [match, ...filtered.filter((_, i) => i !== idx)];
  }, [filtered, highlightTicket]);

  const contactoOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => {
      const val = (t.Contacto ?? "").toString().trim();
      if (val) set.add(val);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const getExportSource = useCallback(() => (filtered.length ? filtered : tickets), [filtered, tickets]);

  const formatCellValue = useCallback(
    (ticket: Ticket, attr: string) => {
      const value = ticket[attr];
      if (value === undefined || value === null) return "";
      if (attr.startsWith("F.")) {
        return formatDate(typeof value === "string" ? value : `${value}`);
      }
      if (typeof value === "object") {
        return JSON.stringify(value);
      }
      return `${value}`;
    },
    [formatDate]
  );

  const mapExportRows = useCallback(() => {
    const source = getExportSource();
    return source.map((ticket: Ticket) => {
      const row: Record<string, string> = {};
      attributes.forEach((attr) => {
        row[attr] = formatCellValue(ticket, attr);
      });
      return row;
    });
  }, [attributes, formatCellValue, getExportSource]);

  const downloadSpreadsheet = useCallback(
    (type: "csv" | "xlsx" | "ods") => {
      const rows = mapExportRows();
      if (!rows.length) {
        showSnackbar("No hay tickets para exportar", "warning");
        return;
      }
      try {
        const sheet = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, sheet, "Tickets");
        const filename = `tickets_${new Date().toISOString().slice(0, 10)}.${type}`;
        XLSX.writeFile(wb, filename, { bookType: type });
        setExcelMenuOpen(false);
        showSnackbar(`Exportado como ${type.toUpperCase()}`, "success");
      } catch (err) {
        console.error("spreadsheet export error", err);
        showSnackbar("No se pudo exportar la planilla", "error");
      }
    },
    [mapExportRows, showSnackbar]
  );

  const downloadPdf = useCallback(() => {
    const rows = mapExportRows();
    if (!rows.length) {
      showSnackbar("No hay tickets para exportar", "warning");
      return;
    }
    try {
      const orientation = attributes.length > 6 ? "landscape" : "portrait";
      const doc = new jsPDF({ orientation });
      autoTable(doc, {
        head: [attributes],
        body: rows.map((row: Record<string, string>) => attributes.map((attr) => row[attr] ?? "")),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [14, 165, 233], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 249, 247] },
      });
      doc.save(`tickets_${new Date().toISOString().slice(0, 10)}.pdf`);
      showSnackbar("PDF descargado", "success");
    } catch (err) {
      console.error("pdf export error", err);
      showSnackbar("No se pudo generar el PDF", "error");
    }
  }, [attributes, mapExportRows, showSnackbar]);

  const updateFilters = (key: keyof typeof filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({ estado: "", contacto: "", usuario: "", motivo: "", modulo: "", submodulo: "", dateFrom: "", dateTo: "", diasMin: "", diasMax: "" });
    setPage(1);
  };

  const activeFiltersCount = useMemo(
    () => Object.values(filters).filter((value) => value !== "").length,
    [filters]
  );

  const toggleToolsPanel = (panel: "new" | "filters") => {
    setToolsPanel((current) => (current === panel ? null : panel));
  };

  const totalPages = Math.max(1, Math.ceil(displayTickets.length / pageSize));
  const paginated = displayTickets.slice((page - 1) * pageSize, page * pageSize);

  const lastTicketNumber = useMemo(() => {
    return tickets.reduce((max, t) => {
      const num = Number(t["Nº ticket"] ?? 0);
      return Number.isFinite(num) ? Math.max(max, num) : max;
    }, 0);
  }, [tickets]);

  const nextTicketNumber = useMemo(() => lastTicketNumber + 1, [lastTicketNumber]);
  const ticketNumberValue = newTicket["Nº ticket"] === "" || newTicket["Nº ticket"] === undefined
    ? nextTicketNumber.toString()
    : `${newTicket["Nº ticket"]}`;

  const handleNewTicketChange = (key: string, value: string) => {
    setNewTicket((prev) => ({ ...prev, [key]: value }));
  };

  const openEditModal = (ticket: Ticket) => {
    setEditingTicket(ticket);
    setEditForm({
      estado: (ticket.Estado ?? "").toString(),
      solucion: (ticket["Solución"] ?? "").toString(),
    });
    setEditError(null);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingTicket(null);
    setEditSaving(false);
    setEditError(null);
  };

  const handleEditField = (key: keyof typeof editForm, value: string) => {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleEditSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editingTicket) return;
    setEditSaving(true);
    setEditError(null);
    const prevSolved = (editingTicket.Estado || "").toString().toLowerCase().includes("solucion");
    const nextSolved = editForm.estado.toLowerCase().includes("solucion");
    const altaValue = nextSolved && !prevSolved ? new Date().toISOString() : editingTicket["F. Alta"];

    try {
      const payload: Ticket = {
        ...editingTicket,
        Estado: editForm.estado,
        "Solución": editForm.solucion,
        "F. Alta": altaValue,
      };
      const res = await fetch(API, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("No se pudo actualizar el ticket");
      const data = await res.json();
      setTickets(data);
      closeEditModal();
      showSnackbar("Ticket actualizado", "success");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error inesperado");
      showSnackbar("No se pudo actualizar el ticket", "error");
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddTicket = async () => {
    if (!newTicket.Incidencia || !newTicket.Estado) {
      showSnackbar("Completa Incidencia y Estado", "warning");
      return;
    }
    const registro = new Date();
    const registroStr = registro.toISOString();
    const isSolved = (newTicket.Estado || "").toLowerCase().includes("solucion");
    const altaStr = isSolved ? registroStr : newTicket["F. Alta"];
    const altaDate = altaStr ? new Date(altaStr) : null;
    const diffMs = (altaDate ? altaDate.getTime() : Date.now()) - registro.getTime();
    const diasCalc = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    const manualNumberRaw = newTicket["Nº ticket"];
    const manualNumberParsed = Number(manualNumberRaw);
    const hasManualNumber = manualNumberRaw !== "" && manualNumberRaw !== undefined && manualNumberRaw !== null;
    const safeTicketNumber = hasManualNumber && Number.isFinite(manualNumberParsed) ? manualNumberParsed : nextTicketNumber;

    const duplicate = tickets.some((ticket) => Number(ticket["Nº ticket"]) === safeTicketNumber);
    if (duplicate) {
      showSnackbar(`El Nº ticket ${safeTicketNumber} ya existe`, "warning");
      return;
    }

    const ticketToAdd: Ticket = {
      ...newTicket,
      "Nº ticket": safeTicketNumber,
      "F. Registro": registroStr,
      "Días": diasCalc,
      "F. Alta": altaStr ?? undefined,
    };
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticketToAdd),
      });
      if (res.status === 409) {
        showSnackbar(`El Nº ticket ${safeTicketNumber} ya existe`, "warning");
        return;
      }
      if (!res.ok) throw new Error("No se pudo agregar el ticket");
      const data = await res.json();
      setTickets(data);
      setPage(1);
      setNewTicket(newTicketTemplate());
      setToolsPanel(null);
      showSnackbar("Ticket agregado", "success");
    } catch {
      showSnackbar("No se pudo agregar el ticket", "error");
    }
  };

  const handleDelete = async (id: number | string | undefined) => {
    const safeId = id !== undefined && id !== null && `${id}` !== "" ? id : undefined;
    if (safeId === undefined) return false;
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(safeId)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("No se pudo eliminar el ticket");
      const data = await res.json();
      setTickets(data);
      setPage(1);
      showSnackbar("Ticket eliminado", "error");
      return true;
    } catch {
      showSnackbar("No se pudo eliminar el ticket", "error");
      return false;
    }
  };

  const handleEdit = (ticket: Ticket) => {
    openEditModal(ticket);
  };

  const requestDelete = (ticket: Ticket) => {
    setPendingDelete(ticket);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setDeleteLoading(false);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteLoading(true);
    // _dbId es el id real en MySQL; si no existe cae al Nº ticket
    const deleteId = pendingDelete["_dbId"] ?? pendingDelete["Nº ticket"];
    const success = await handleDelete(deleteId);
    setDeleteLoading(false);
    if (success) {
      setPendingDelete(null);
    }
  };

  if (auth.role !== "admin" && auth.role !== "dev") {
    return (
      <div className={`${pageStyles.page} ${poppins.className} ${darkMode ? pageStyles.dark : ""}`}>
        <main className={pageStyles.main}>
          <p style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>No tienes permisos para ver esta sección.</p>
        </main>
      </div>
    );
  }

  return (
    <div
      className={`${pageStyles.page} ${poppins.className} ${collapsed ? pageStyles.collapsed : ""} ${
        darkMode ? pageStyles.dark : ""
      } ${sidebarRight ? pageStyles.sidebarRight : ""}`}
    >
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <main className={pageStyles.main}>
        <Header
          showNotifications={showNotifications}
          setShowNotifications={setShowNotifications}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          sidebarRight={sidebarRight}
          setSidebarRight={setSidebarRight}
        />

        <PageContent>
          <div className={styles.pageBody}>
            <div className={`${styles.tableCard}`}>
              <div className={styles.tableHeader}>
                <div className={styles.tableHeaderCopy}>
                  <p>Tickets recientes</p>
                  <span>Sincronizados con Soporte</span>
                </div>
                <div className={styles.tableToolbar}>
                  <div className={styles.tableToolbarGroup}>
                    <button
                      type="button"
                      className={`${styles.toolBtn} ${toolsPanel === "new" ? styles.toolBtnActive : ""}`}
                      onClick={() => toggleToolsPanel("new")}
                      aria-expanded={toolsPanel === "new"}
                    >
                      <FiPlus />
                      <span>Nuevo ticket</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.toolBtn} ${toolsPanel === "filters" ? styles.toolBtnActive : ""}`}
                      onClick={() => toggleToolsPanel("filters")}
                      aria-expanded={toolsPanel === "filters"}
                    >
                      <FiFilter />
                      <span>Filtros</span>
                      {activeFiltersCount > 0 && (
                        <span className={styles.toolBtnBadge}>{activeFiltersCount}</span>
                      )}
                    </button>
                  </div>
                  <span className={styles.tableToolbarDivider} aria-hidden />
                  <div className={styles.exportActions}>
                    <button
                      type="button"
                      className={`${styles.downloadBtn} ${styles.navasoftBtn}`}
                      onClick={handleNavasoftUpdate}
                      disabled={navasoftUpdating || importing}
                      title={navasoftProgress ?? "Actualizar tickets directamente desde Navasoft"}
                    >
                      <FiRefreshCw className={navasoftUpdating ? styles.refreshSpinning : undefined} />
                      {navasoftUpdating ? navasoftProgress ?? "Actualizando…" : "Actualizar Navasoft"}
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className={styles.hiddenFileInput}
                      onChange={handleImportFile}
                    />
                    <button
                      type="button"
                      className={`${styles.downloadBtn} ${styles.uploadBtn}`}
                      onClick={triggerImportDialog}
                      disabled={importing}
                    >
                      <FiUpload /> {importing ? "Importando…" : "Importar"}
                    </button>
                    <button type="button" className={`${styles.downloadBtn} ${styles.pdfBtn}`} onClick={downloadPdf}>
                      <FiFileText /> PDF
                    </button>
                    <div className={styles.excelDropdown} ref={excelMenuRef}>
                      <button
                        type="button"
                        className={styles.downloadBtn}
                        onClick={() => setExcelMenuOpen((prev) => !prev)}
                        aria-expanded={excelMenuOpen}
                        aria-controls="excel-menu"
                      >
                        <FiDownload /> Excel / CSV <FiChevronDown className={excelMenuOpen ? styles.chevronOpen : ""} />
                      </button>
                      {excelMenuOpen && (
                        <div className={styles.exportMenu} id="excel-menu">
                          <button type="button" onClick={() => downloadSpreadsheet("xlsx")}>
                            <FiFile /> XLSX (Excel)
                          </button>
                          <button type="button" onClick={() => downloadSpreadsheet("csv")}>
                            <FiFileText /> CSV
                          </button>
                          <button type="button" onClick={() => downloadSpreadsheet("ods")}>
                            <FiLayers /> ODS (Hojas de cálculo)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`${styles.toolsPanelWrap} ${toolsPanel ? styles.toolsPanelWrapOpen : ""}`}>
                {toolsPanel === "new" && (
                  <div className={styles.toolsPanel}>
                    <div className={styles.toolsPanelHeader}>
                      <div>
                        <div className={styles.toolsPanelTitle}>Nuevo ticket</div>
                        <div className={styles.toolsPanelSubtitle}>Completa los campos mínimos y agrégalo a la lista.</div>
                      </div>
                      <div className={styles.toolsPanelActions}>
                        <button type="button" className={styles.primaryBtn} onClick={handleAddTicket}>Agregar</button>
                        <button type="button" className={styles.panelCloseBtn} onClick={() => setToolsPanel(null)} aria-label="Cerrar">
                          <FiX />
                        </button>
                      </div>
                    </div>
                    <div className={styles.formGrid}>
                      <label>
                        <span>F. Registro</span>
                        <input type="datetime-local" value={newTicket["F. Registro"]} readOnly />
                      </label>
                      <label>
                        <span>Nº ticket</span>
                        <input
                          type="number"
                          min={nextTicketNumber}
                          value={ticketNumberValue}
                          onChange={(e) => handleNewTicketChange("Nº ticket", e.target.value)}
                        />
                      </label>
                      <label className={styles.colSpan2}>
                        <span>Incidencia *</span>
                        <textarea rows={3} value={newTicket.Incidencia} onChange={(e) => handleNewTicketChange("Incidencia", e.target.value)} />
                      </label>
                      <label className={styles.colSpan2}>
                        <span>Solución</span>
                        <textarea rows={2} value={newTicket["Solución"]} onChange={(e) => handleNewTicketChange("Solución", e.target.value)} />
                      </label>
                      <label>
                        <span>Contacto</span>
                        <input
                          list="contactoOptions"
                          value={newTicket.Contacto}
                          onChange={(e) => handleNewTicketChange("Contacto", e.target.value)}
                          placeholder="Escribe o selecciona"
                        />
                        <datalist id="contactoOptions">
                          {contactoOptions.map((opt) => (
                            <option key={opt} value={opt} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        <span>Estado</span>
                        <select value={newTicket.Estado ?? estadoChoices[0] ?? ""} onChange={(e) => handleNewTicketChange("Estado", e.target.value)}>
                          {estadoChoices.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                          {newTicket.Estado &&
                            !estadoChoices.some((opt) => normalizeEstadoKey(opt) === normalizeEstadoKey(newTicket.Estado as string)) && (
                              <option value={newTicket.Estado as string}>{newTicket.Estado}</option>
                            )}
                        </select>
                      </label>
                      <label>
                        <span>Usuario a Cargo</span>
                        <input
                          list="ownerOptions"
                          value={newTicket["Usuario a Cargo"]}
                          onChange={(e) => handleNewTicketChange("Usuario a Cargo", e.target.value)}
                          placeholder="Escribe o selecciona"
                        />
                        <datalist id="ownerOptions">
                          {ownerOptions.map((opt) => (
                            <option key={opt} value={opt} />
                          ))}
                        </datalist>
                      </label>
                    </div>
                  </div>
                )}

                {toolsPanel === "filters" && (
                  <div className={styles.toolsPanel}>
                    <div className={styles.toolsPanelHeader}>
                      <div>
                        <div className={styles.toolsPanelTitle}>Filtros de tickets</div>
                        <div className={styles.toolsPanelSubtitle}>
                          {activeFiltersCount > 0
                            ? `${activeFiltersCount} filtro${activeFiltersCount === 1 ? "" : "s"} activo${activeFiltersCount === 1 ? "" : "s"}`
                            : "Refina la tabla sin salir de esta vista."}
                        </div>
                      </div>
                      <div className={styles.toolsPanelActions}>
                        <button type="button" className={styles.clearFiltersBtn} onClick={resetFilters}>
                          Limpiar filtros
                        </button>
                        <button type="button" className={styles.panelCloseBtn} onClick={() => setToolsPanel(null)} aria-label="Cerrar">
                          <FiX />
                        </button>
                      </div>
                    </div>
                    <div className={styles.filtersGrid}>
                      <label className={styles.filterLabel}>Estado
                        <select className={styles.filterInput} value={filters.estado} onChange={(e) => updateFilters("estado", e.target.value)}>
                          <option value="">Todos</option>
                          {estadoChoices.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                          {filters.estado &&
                            !estadoChoices.some((opt) => normalizeEstadoKey(opt) === normalizeEstadoKey(filters.estado)) && (
                              <option value={filters.estado}>{filters.estado}</option>
                            )}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Usuario
                        <select className={styles.filterInput} value={filters.usuario} onChange={(e) => updateFilters("usuario", e.target.value)}>
                          <option value="">Todos</option>
                          {ownerOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Motivo
                        <select className={styles.filterInput} value={filters.motivo} onChange={(e) => updateFilters("motivo", e.target.value)}>
                          <option value="">Todos</option>
                          {motiveOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Contacto
                        <select className={styles.filterInput} value={filters.contacto} onChange={(e) => updateFilters("contacto", e.target.value)}>
                          <option value="">Todos</option>
                          {contactoOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Módulo
                        <select className={styles.filterInput} value={filters.modulo} onChange={(e) => updateFilters("modulo", e.target.value)}>
                          <option value="">Todos</option>
                          {moduleOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Submódulo
                        <select className={styles.filterInput} value={filters.submodulo} onChange={(e) => updateFilters("submodulo", e.target.value)}>
                          <option value="">Todos</option>
                          {submoduleOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.filterLabel}>Fecha desde
                        <input type="date" className={styles.filterInput} value={filters.dateFrom} onChange={(e) => updateFilters("dateFrom", e.target.value)} />
                      </label>
                      <label className={styles.filterLabel}>Fecha hasta
                        <input type="date" className={styles.filterInput} value={filters.dateTo} onChange={(e) => updateFilters("dateTo", e.target.value)} />
                      </label>
                      <label className={styles.filterLabel}>Días min
                        <input className={styles.filterInput} value={filters.diasMin} onChange={(e) => updateFilters("diasMin", e.target.value)} placeholder="0" />
                      </label>
                      <label className={styles.filterLabel}>Días max
                        <input className={styles.filterInput} value={filters.diasMax} onChange={(e) => updateFilters("diasMax", e.target.value)} placeholder="" />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {attributes.map((a) => <th key={a}>{a}</th>)}
                      <th className={styles.actionsCol}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((t, idx) => (
                      <tr key={idx} className={highlightTicket && `${t["Nº ticket"]}` === highlightTicket ? styles.highlightRow : undefined}>
                        {attributes.map((a) => (
                          <td key={a}>
                            {a === "Estado" ? (
                              <span className={styles.stateBadge} style={getEstadoStyle(t[a] as string)}>
                                {(t[a] ?? "—").toString()}
                              </span>
                            ) : (
                              t[a]
                            )}
                          </td>
                        ))}
                        <td className={styles.actionsCol}>
                          <button type="button" className={styles.iconBtn} onClick={() => handleEdit(t)} aria-label="Editar">
                            <FiEdit2 />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconDanger}`}
                            onClick={() => requestDelete(t)}
                            aria-label="Eliminar"
                          >
                            <FiTrash2 />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!paginated.length && (
                      <tr>
                        <td colSpan={attributes.length + 1}>
                          <EmptyState
                            title="No hay filas que coincidan"
                            description="Prueba a relajar filtros o la búsqueda; si la tabla está vacía, sincroniza o importa datos desde la barra superior."
                            compact
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className={styles.pagination}>
                <button className={styles.pageBtn} disabled={page===1} onClick={() => setPage(p => Math.max(1, p-1))}>← Anterior</button>
                <span className={styles.pageInfo}>Página {page} de {totalPages}</span>
                <button className={styles.pageBtn} disabled={page===totalPages} onClick={() => setPage(p => Math.min(totalPages, p+1))}>Siguiente →</button>
              </div>
            </div>

          </div>

        {navasoftPanelOpen && navasoftPanelSrc && (
          <div className={styles.navasoftOverlay}>
            <iframe
              src={navasoftPanelSrc}
              className={styles.navasoftFrame}
              title="Terminales de sincronización Navasoft"
              allowTransparency
            />
          </div>
        )}

        {showEditModal && editingTicket && (
          <div className={`${styles.modalOverlay} ${darkMode ? "dark" : ""}`}>
            <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label={`Editar ticket ${editingTicket["Nº ticket"]}`}>
              <div className={styles.modalHeader}>
                <div>
                  <h4>Ticket #{editingTicket["Nº ticket"]}</h4>
                  <p>Actualiza el estado y la solución registrada.</p>
                </div>
                <button type="button" className={styles.closeLookup} onClick={closeEditModal} aria-label="Cerrar edición">
                  ×
                </button>
              </div>
              <div className={styles.modalStats}>
                {[
                  { label: "Nº ticket", value: `#${editingTicket["Nº ticket"]}` },
                  { label: "Días abiertos", value: `${getDiasValue(editingTicket)}` },
                  { label: "F. registro", value: formatDate(editingTicket["F. Registro"] as string) },
                  { label: "F. alta", value: formatDate(editingTicket["F. Alta"] as string) },
                ].map((stat) => (
                  <div key={stat.label} className={styles.statCard}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                  </div>
                ))}
              </div>
              <div className={styles.modalBodyGrid}>
                <form className={styles.modalForm} onSubmit={handleEditSubmit}>
                  <label>
                    <span>Estado</span>
                    <select value={editForm.estado} onChange={(e) => handleEditField("estado", e.target.value)}>
                      {estadoChoices.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {editForm.estado &&
                        !estadoChoices.some((opt) => normalizeEstadoKey(opt) === normalizeEstadoKey(editForm.estado)) && (
                          <option value={editForm.estado}>{editForm.estado}</option>
                        )}
                    </select>
                  </label>
                  <label className={styles.modalTextareaLabel}>
                    <span>Solución / Comentarios</span>
                    <textarea
                      rows={8}
                      value={editForm.solucion}
                      onChange={(e) => handleEditField("solucion", e.target.value)}
                      placeholder="Describe la acción tomada"
                    />
                  </label>
                  {editError && <div className={styles.modalError}>{editError}</div>}
                  <div className={styles.modalActions}>
                    <button type="button" className={styles.ghostBtn} onClick={closeEditModal} disabled={editSaving}>
                      Cancelar
                    </button>
                    <button type="submit" className={styles.primaryBtn} disabled={editSaving}>
                      {editSaving ? "Guardando..." : "Guardar cambios"}
                    </button>
                  </div>
                </form>
                <div className={styles.modalDetails}>
                  <div className={styles.detailBlock}>
                    <span>Incidencia</span>
                    <p>{editingTicket.Incidencia || "Sin descripción"}</p>
                  </div>
                  <div className={styles.detailGrid}>
                    <div>
                      <span>Asignado</span>
                      <p>{editingTicket["Usuario a Cargo"] || "No asignado"}</p>
                    </div>
                    <div>
                      <span>Contacto</span>
                      <p>{editingTicket.Contacto || "Sin contacto"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {pendingDelete && (
          <div className={`${styles.modalOverlay} ${darkMode ? "dark" : ""}`}>
            <div className={styles.confirmCard} role="dialog" aria-modal="true" aria-label="Confirmar eliminación">
              <h3>
                ¿Eliminar ticket{" "}
                {pendingDelete["Nº ticket"] != null
                  ? `#${pendingDelete["Nº ticket"]}`
                  : `«${String(pendingDelete.Incidencia ?? pendingDelete["_dbId"] ?? "sin número").slice(0, 30)}»`}
                ?
              </h3>
              <p>Esta acción no se puede deshacer. Confirma si deseas eliminarlo definitivamente.</p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.ghostBtn} onClick={cancelDelete} disabled={deleteLoading}>
                  Cancelar
                </button>
                <button type="button" className={styles.dangerBtn} onClick={confirmDelete} disabled={deleteLoading}>
                  {deleteLoading ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={styles.snackbarStack} aria-live="polite">
          {snackbars.map((snack) => (
            <div key={snack.id} className={`${styles.snackbar} ${styles[`snackbar_${snack.tone}`]}`}>
              <div className={styles.snackbarInner}>
                <span className={styles.snackbarIcon}>{snackbarIcons[snack.tone]}</span>
                <span className={styles.snackbarMessage}>{snack.message}</span>
              </div>
              <div className={styles.snackbarBar}>
                <div className={styles.snackbarBarFill} style={{ animationDuration: `${snack.duration}ms` }} />
              </div>
            </div>
          ))}
        </div>
        </PageContent>
      </main>

    </div>
  );
}
