"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { poppins } from "@/fonts";
import { resolveUsersApi, resolveNotionTabsApi, resolveColumnsApi, resolveTasksApi, resolveSharesApi } from "@/utils/api";
import {
  FiUsers, FiPlus, FiTrash2, FiEdit2, FiEye, FiLayers, FiRefreshCw,
  FiType, FiHash, FiCheckCircle, FiCalendar, FiUsers as FiPersonas,
  FiLink, FiMail, FiPhone, FiArrowUpRight, FiMapPin, FiClock, FiX, FiDownload,
  FiShare2, FiUserCheck, FiUser, FiPaperclip,
} from "react-icons/fi";
import { AttachmentSummary } from "@/components/AttachmentDisplay";
import type { AttachmentValue } from "@/lib/attachments";
import styles from "../page.module.css";
import notionStyles from "../notion/page.module.css";
import tabChrome from "../notion/notionChrome.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useCalendarToggle } from "@/contexts/CalendarToggleContext";
import { usePageShell } from "@/hooks/usePageShell";
import { useAuthSession, type UserRole } from "@/components/AuthGate";
import type { NotionTab } from "@/hooks/useNotionTabs";
import { getAutoIdValue, getIdColumnLabel, isAutoIdColumn, sortRowsByStoredColumn } from "@/lib/notionColumnUtils";
import { optionChipStyle, resolveOptionHexColor } from "@/lib/notionOptionColors";
import { DEPARTMENT_AREAS, sanitizeDepartmentAreas } from "@/lib/departments";
import userModalStyles from "./page.module.css";

type NotionColumn = {
  id?: string;
  title: string;
  savedTitle: string;
  type: string;
  hidden?: boolean;
  options?: string[];
  optionColors?: Record<string, string>;
  fieldKey?: string;
  width?: number;
  sort?: string;
};

type NotionColumnsData = {
  baseColumns: NotionColumn[];
  customColumns: NotionColumn[];
};

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function resolveFieldKey(col: NotionColumn, index: number, kind: "base" | "custom"): string {
  if (col.fieldKey) return col.fieldKey;
  if (kind === "base") {
    const map: Record<string, string> = {
      Usuario: "usuario", Área: "area", Actividad: "actividad",
      Lugar: "lugar", Fecha: "fecha", Casilla: "casilla", Estado: "estado",
    };
    // Primero por savedTitle, luego por type (ej: "Fecha límite" tiene type "Fecha")
    if (map[col.savedTitle]) return map[col.savedTitle];
    if (map[col.type])        return map[col.type];
    if (col.id)               return col.id;
    return `base_${slugify(col.savedTitle || col.title)}_${index + 1}`;
  }
  if (col.type === "Fecha de creación") return "createdAt";
  if (col.type === "Última edición")    return "updatedAt";
  if (col.type === "Creado por")        return "createdBy";
  if (col.type === "Última edición por") return "lastEditedBy";
  // Para columnas custom: primero por id si existe, luego por título slugificado
  if (col.id) return col.id;
  return `custom_${slugify(col.type || col.title)}_${index + 1}`;
}

function getViewedLegacyKeys(col: NotionColumn, index: number, kind: "base" | "custom", key: string): string[] {
  if (kind === "custom") {
    const legacyByType = `custom_${slugify(col.type || col.title || "column")}_${index}`;
    const legacyByTitle = `custom_${slugify(col.title || col.type || "column")}_${index}`;
    return [legacyByType, legacyByTitle].filter((k, pos, arr) => k !== key && arr.indexOf(k) === pos);
  }
  const legacy: string[] = [];
  if (col.id && col.id !== key) legacy.push(col.id);
  const slugKey = `base_${slugify(col.savedTitle || col.title || "field")}_${index + 1}`;
  if (slugKey !== key && !legacy.includes(slugKey)) legacy.push(slugKey);
  return legacy;
}

function readViewedTaskField(
  task: Record<string, unknown>,
  key: string,
  col: NotionColumn,
  kind: "base" | "custom",
  index: number,
): unknown {
  for (const k of [key, ...getViewedLegacyKeys(col, index, kind, key)]) {
    if (task[k] !== undefined) return task[k];
  }
  return undefined;
}

type ViewColMeta = { col: NotionColumn; key: string; kind: "base" | "custom"; index: number };

const COL_ICONS: Record<string, React.ReactNode> = {
  ID: <FiHash size={12} />,
  Personas: <FiPersonas size={12} />,
  Texto: <FiType size={12} />,
  Número: <FiHash size={12} />,
  Estado: <FiLayers size={12} />,
  Fecha: <FiCalendar size={12} />,
  Casilla: <FiCheckCircle size={12} />,
  URL: <FiLink size={12} />,
  "Correo electrónico": <FiMail size={12} />,
  Teléfono: <FiPhone size={12} />,
  Relación: <FiArrowUpRight size={12} />,
  "Selección múltiple": <FiLayers size={12} />,
  Seleccionar: <FiLayers size={12} />,
  "Archivos y multimedia": <FiPaperclip size={12} />,
  Lugar: <FiMapPin size={12} />,
  "Fecha de creación": <FiClock size={12} />,
  "Última edición": <FiClock size={12} />,
  "Creado por": <FiUser size={12} />,
  "Última edición por": <FiUser size={12} />,
};

function formatDate(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function getLocationLabel(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return String(v.label || v.display_name || v.query || "");
  }
  return "";
}

type RenderNotionCellOpts = {
  onFechaClick?: (date: Date) => void;
};

function renderNotionCell(value: unknown, type: string, optionColors?: Record<string, string>, opts?: RenderNotionCellOpts): React.ReactNode {
  if (type === "ID") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 1) {
      return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    }
    return <span style={{ color: "var(--text-dim)", fontWeight: 600, fontSize: 12 }}>{n}</span>;
  }

  if (value === undefined || value === null || value === "") return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;

  if (type === "Casilla") {
    const checked = value === true || value === "true" || value === 1 || value === "✓" || value === "sí" || value === "si" || value === "1";
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 16, height: 16, borderRadius: 4,
        border: `1.5px solid ${checked ? "#10B981" : "var(--border)"}`,
        background: checked ? "#10B981" : "transparent",
        color: "#fff", fontSize: 10,
      }}>
        {checked ? "✓" : ""}
      </span>
    );
  }

  if (type === "Estado" || type === "Seleccionar" || type === "Relación") {
    const label = String(value).trim();
    if (!label) return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    const chipColor = resolveOptionHexColor(label, { optionColors });
    return (
      <span className={notionStyles.selectChip} style={optionChipStyle(chipColor)}>
        {label}
      </span>
    );
  }

  if (type === "Selección múltiple" || type === "Personas") {
    const items = typeof value === "string"
      ? value.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    if (!items.length) return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    return (
      <div className={notionStyles.multiChipList}>
        {items.map((item) => {
          const chipColor = resolveOptionHexColor(item, { optionColors });
          return (
            <span key={item} className={notionStyles.selectChip} style={optionChipStyle(chipColor)}>
              {item}
            </span>
          );
        })}
      </div>
    );
  }

  if (type === "Fecha") {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    const d = raw.includes("T") ? new Date(raw) : new Date(`${raw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{String(value)}</span>;
    }
    const label = formatDate(value);
    return (
      <button
        type="button"
        title="Abrir calendario en esta fecha"
        onClick={(e) => {
          e.stopPropagation();
          opts?.onFechaClick?.(d);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          maxWidth: "100%",
          padding: "2px 6px",
          margin: 0,
          border: "1px solid color-mix(in srgb, var(--border) 80%, var(--primary) 15%)",
          borderRadius: 6,
          background: "color-mix(in srgb, var(--primary) 6%, transparent)",
          color: "var(--text)",
          font: "inherit",
          fontSize: 12,
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <FiCalendar size={12} style={{ flexShrink: 0, opacity: 0.85 }} />
        {label}
      </button>
    );
  }

  if (type === "Fecha de creación" || type === "Última edición") {
    return <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{formatDate(value)}</span>;
  }

  if (type === "Creado por" || type === "Última edición por") {
    const name = String(value).trim();
    if (!name) return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg)", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
        <FiUser size={10} /> {name}
      </span>
    );
  }

  if (type === "Archivos y multimedia") {
    const attachments = normalizeAttachmentList(value);
    if (!attachments.length) return <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
    return <AttachmentSummary attachments={attachments} maxVisible={3} />;
  }

  if (type === "Lugar") {
    const label = getLocationLabel(value);
    return label ? (
      <span className={notionStyles.notionLocationTag}>
        {label}
      </span>
    ) : <span style={{ color: "var(--text-dim)", opacity: 0.4 }}>—</span>;
  }

  if (type === "Correo electrónico") {
    const email = String(value);
    return <a href={`mailto:${email}`} style={{ color: "#3B82F6", fontSize: 12, textDecoration: "none" }}>{email}</a>;
  }

  if (type === "Teléfono") {
    return <span style={{ fontFamily: "monospace", fontSize: 12 }}>{String(value)}</span>;
  }

  if (type === "URL") {
    const url = String(value);
    return <a href={url} target="_blank" rel="noreferrer" style={{ color: "#3B82F6", fontSize: 12, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", display: "block", maxWidth: 160 }}>{url}</a>;
  }

  if (typeof value === "object" && value !== null) {
    return <span style={{ fontSize: 12 }}>{JSON.stringify(value)}</span>;
  }
  return <span style={{ fontSize: 12 }}>{String(value)}</span>;
}

function normalizeAttachmentList(value: unknown): AttachmentValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const a = item as Partial<AttachmentValue>;
      if (!a.name || (!a.dataUrl && !a.url && !a.hasData)) return null;
      return {
        name: String(a.name),
        type: String(a.type || "application/octet-stream"),
        size: Number(a.size || 0),
        ...(a.id ? { id: String(a.id) } : {}),
        ...(a.dataUrl ? { dataUrl: String(a.dataUrl) } : {}),
        ...(a.url ? { url: String(a.url) } : {}),
        ...(a.hasData ? { hasData: true } : {}),
      } as AttachmentValue;
    })
    .filter((item): item is AttachmentValue => Boolean(item));
}


type UserInfo = { id: string; username: string; displayName: string; role: UserRole; areas: string[]; createdAt: string; updatedAt: string };

const ROLE_LABELS: Record<UserRole, string> = { user: "Usuario", admin: "Admin", dev: "Dev" };
const ROLE_COLORS: Record<UserRole, string> = { user: "#3B82F6", admin: "#F59E0B", dev: "#10B981" };

export default function UsuariosPage() {
  const { showNotifications, setShowNotifications, showSettings, setShowSettings, darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = usePageShell();
  const { setShowCalendar } = useCalendarToggle();
  const auth = useAuthSession();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [viewingUser, setViewingUser] = useState<UserInfo | null>(null);
  const [viewedTabs, setViewedTabs] = useState<NotionTab[]>([]);
  const [viewedTasks, setViewedTasks] = useState<Record<string, unknown>[]>([]);
  const [viewedActiveTab, setViewedActiveTab] = useState("");
  const [viewedColumns, setViewedColumns] = useState<NotionColumnsData>({ baseColumns: [], customColumns: [] });
  const [viewedColWidths, setViewedColWidths] = useState<Record<string, number>>({});
  const [viewedRefreshedAt, setViewedRefreshedAt] = useState<Date | null>(null);
  const [viewedRefreshing, setViewedRefreshing] = useState(false);
  const [showViewExportMenu, setShowViewExportMenu] = useState(false);
  const [viewedViewFilter, setViewedViewFilter] = useState<"all" | "status" | "responsible" | "location">("all");
  const [showViewedFilterMenu, setShowViewedFilterMenu] = useState(false);
  const [viewedSelectedStatus, setViewedSelectedStatus] = useState<string | null>(null);
  const [viewedSelectedResponsible, setViewedSelectedResponsible] = useState<string | null>(null);
  const [viewedSelectedLocation, setViewedSelectedLocation] = useState<string | null>(null);
  const resizeRef = React.useRef<{ key: string; startX: number; startW: number } | null>(null);
  const viewedActiveTabRef = React.useRef("");
  const [colResizeActive, setColResizeActive] = useState(false);
  /** Shares que el usuario visualizado envía (dueño → otros), por tab_id */
  const [viewedOutboundSharesByTab, setViewedOutboundSharesByTab] = useState<
    Record<string, Array<{ shared_with_id: string; shared_with_name?: string; status: string }>>
  >({});

  const loadViewedOutboundShares = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`${resolveSharesApi()}?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list)) return;
      const byTab: Record<string, Array<{ shared_with_id: string; shared_with_name?: string; status: string }>> = {};
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as { owner_id?: string; tab_id?: string; shared_with_id?: string; shared_with_name?: string; status?: string };
        if (row.owner_id !== userId || row.status === "declined" || !row.tab_id || !row.shared_with_id) continue;
        const tid = row.tab_id;
        if (!byTab[tid]) byTab[tid] = [];
        byTab[tid].push({
          shared_with_id: row.shared_with_id,
          shared_with_name: row.shared_with_name,
          status: String(row.status || ""),
        });
      }
      setViewedOutboundSharesByTab(byTab);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (!colResizeActive) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [colResizeActive]);

  // Resize handlers (document-level, activos solo al arrastrar)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ref = resizeRef.current;
      if (!ref) return;
      const delta = e.clientX - ref.startX;
      const newW = Math.max(60, ref.startW + delta);
      setViewedColWidths(prev => ({ ...prev, [ref.key]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      setColResizeActive(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  const startResize = (key: string, startX: number, currentW: number) => {
    resizeRef.current = { key, startX, startW: currentW };
    setColResizeActive(true);
  };

  const resetViewedFilters = useCallback(() => {
    setViewedViewFilter("all");
    setViewedSelectedStatus(null);
    setViewedSelectedResponsible(null);
    setViewedSelectedLocation(null);
    setShowViewedFilterMenu(false);
  }, []);

  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("user");
  const [formAreas, setFormAreas] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  const role = auth.role;
  const isDev = role === "dev";

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(resolveUsersApi(), { credentials: "include", cache: "no-store" });
      if (res.ok) setUsers(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const tid = window.setTimeout(() => void fetchUsers(), 0);
    return () => window.clearTimeout(tid);
  }, [fetchUsers]);

  const resetForm = () => { setFormUsername(""); setFormDisplayName(""); setFormPassword(""); setFormRole("user"); setFormAreas([]); setFormError(null); setFormSaving(false); };

  const toggleFormArea = (area: string) => {
    setFormAreas((prev) => (prev.includes(area) ? prev.filter((x) => x !== area) : [...prev, area]));
  };

  const readApiError = async (res: Response) => {
    const text = await res.text();
    try {
      const d = JSON.parse(text) as { error?: string };
      if (d?.error) return d.error;
    } catch {
      /* HTML u otro */
    }
    if (res.status === 500) return "Error del servidor al guardar (500). Revisa users.php en el hosting.";
    if (res.status === 403) return "No tienes permiso para editar usuarios.";
    return `Error al guardar (HTTP ${res.status})`;
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!formUsername.trim() || !formPassword.trim()) { setFormError("Usuario y contraseña requeridos"); return; }
    setFormSaving(true);
    try {
      const areas = sanitizeDepartmentAreas(formAreas);
      const res = await fetch(resolveUsersApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: formUsername, password: formPassword, displayName: formDisplayName || formUsername, role: formRole, areas }),
      });
      if (!res.ok) { setFormError(await readApiError(res)); return; }
      setShowCreateModal(false); resetForm(); fetchUsers();
    } finally {
      setFormSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setFormError(null);
    setFormSaving(true);
    try {
      const areas = sanitizeDepartmentAreas(formAreas);
      const body: Record<string, unknown> = {
        action: "update",
        id: editingUser.id,
        displayName: formDisplayName,
        role: formRole,
        areas,
      };
      if (formUsername && formUsername !== editingUser.username) body.username = formUsername;
      if (formPassword) body.password = formPassword;
      // POST+action=update: más fiable en hosting que bloquea PUT
      const res = await fetch(resolveUsersApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) { setFormError(await readApiError(res)); return; }
      setEditingUser(null); resetForm(); fetchUsers();
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este usuario permanentemente?")) return;
    const api = resolveUsersApi();
    await fetch(`${api}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
    fetchUsers();
  };

  const openEdit = (u: UserInfo) => { setEditingUser(u); setFormUsername(u.username); setFormDisplayName(u.displayName); setFormRole(u.role); setFormAreas(sanitizeDepartmentAreas(u.areas)); setFormPassword(""); setFormError(null); };

  const viewingUserRef = React.useRef<UserInfo | null>(null);

  const refreshViewedTabs = async (u: UserInfo, keepActiveTab = false) => {
    const res = await fetch(`${resolveNotionTabsApi()}?userId=${encodeURIComponent(u.id)}`, { cache: "no-store" });
    if (!res.ok) return;
    const d = await res.json();
    const tabs: NotionTab[] = Array.isArray(d.tabs) ? d.tabs : [];
    setViewedTabs(tabs);
    if (!keepActiveTab) {
      if (tabs.length) { await loadTabData(tabs[0].id); }
      else { setViewedActiveTab(""); setViewedTasks([]); }
    } else if (viewedActiveTabRef.current) {
      // Si el tab activo ya no existe, cargar el primero
      const stillExists = tabs.some(t => t.id === viewedActiveTabRef.current);
      if (!stillExists && tabs.length) await loadTabData(tabs[0].id);
    }
  };

  const openViewNotions = async (u: UserInfo) => {
    viewingUserRef.current = u;
    setViewingUser(u);
    setViewedTasks([]);
    setViewedColumns({ baseColumns: [], customColumns: [] });
    resetViewedFilters();
    await refreshViewedTabs(u, false);
    await loadViewedOutboundShares(u.id);
  };

  const loadTabData = async (tabId: string, silent = false) => {
    if (!silent) {
      setViewedActiveTab(tabId);
      resetViewedFilters();
    }
    viewedActiveTabRef.current = tabId;
    if (!silent) setViewedRefreshing(true);
    const [tasksRes, colsRes] = await Promise.all([
      fetch(`${resolveTasksApi()}?tabId=${encodeURIComponent(tabId)}`, { cache: "no-store" }),
      fetch(`${resolveColumnsApi()}?tabId=${encodeURIComponent(tabId)}`, { cache: "no-store" }),
    ]);
    if (tasksRes.ok) setViewedTasks(await tasksRes.json());
    else setViewedTasks([]);
    if (colsRes.ok) setViewedColumns(await colsRes.json());
    else setViewedColumns({ baseColumns: [], customColumns: [] });
    setViewedRefreshedAt(new Date());
    setViewedRefreshing(false);
  };

  const exportViewedTable = (format: "xlsx" | "csv") => {
    if (!viewingUser || viewAllCols.length === 0) return;
    const headers = viewAllCols.map(({ col }) => col.title);
    const body = filteredViewedTasks.map((task, rowIdx) =>
      viewAllCols.map(({ col, key, kind, index }) => {
        if (isAutoIdColumn(col)) return String(getAutoIdValue(rowIdx));
        const val = readViewedTaskField(task, key, col, kind, index);
        if (col.type === "Casilla") return (val === true || val === "true" || val === 1 || val === "✓" || val === "sí" || val === "si" || val === "1") ? "Sí" : "No";
        if (col.type === "Fecha") return formatDate(val);
        if (col.type === "Lugar") return getLocationLabel(val);
        if (val === null || val === undefined) return "";
        return String(val);
      })
    );
    const tabTitle = viewedTabs.find(t => t.id === viewedActiveTab)?.title || "Tabla";
    const fileName = `${viewingUser.displayName}_${tabTitle}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    XLSX.utils.book_append_sheet(wb, ws, tabTitle.slice(0, 31));
    XLSX.writeFile(wb, `${fileName}.${format}`, { bookType: format });
    setShowViewExportMenu(false);
  };

  useEffect(() => {
    if (!showViewExportMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-notion-menu-root]")) {
        setShowViewExportMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showViewExportMenu]);

  // Auto-refresh cada 5 s: tabs + tareas del tab activo
  React.useEffect(() => {
    if (!viewingUser) return;
    viewingUserRef.current = viewingUser;
    const interval = setInterval(async () => {
      const u = viewingUserRef.current;
      if (!u) return;
      // Refrescar lista de tabs (sin cambiar el tab activo)
      const tabsRes = await fetch(`${resolveNotionTabsApi()}?userId=${encodeURIComponent(u.id)}`, { cache: "no-store" });
      if (tabsRes.ok) {
        const d = await tabsRes.json();
        const tabs: NotionTab[] = Array.isArray(d.tabs) ? d.tabs : [];
        setViewedTabs(tabs);
      }
      if (u.id) await loadViewedOutboundShares(u.id);
      // Refrescar datos del tab activo
      if (viewedActiveTabRef.current) loadTabData(viewedActiveTabRef.current, true);
    }, 5_000);
    return () => clearInterval(interval);
  }, [viewingUser, loadViewedOutboundShares]);

  const viewAllCols = useMemo<ViewColMeta[]>(() => [
    ...viewedColumns.baseColumns.filter(c => !c.hidden).map((col, i) => ({ col, key: resolveFieldKey(col, i, "base"), kind: "base" as const, index: i })),
    ...viewedColumns.customColumns.filter(c => !c.hidden).map((col, i) => ({ col, key: resolveFieldKey(col, i, "custom"), kind: "custom" as const, index: i })),
  ], [viewedColumns]);

  const filteredViewedTasks = useMemo(() => {
    let result = viewedTasks;
    const statusCol = viewAllCols.find(({ col }) => col.type === "Estado");
    if (viewedViewFilter === "status" && viewedSelectedStatus && statusCol) {
      result = result.filter((task) =>
        String(readViewedTaskField(task, statusCol.key, statusCol.col, statusCol.kind, statusCol.index) ?? "").trim() === viewedSelectedStatus
      );
    }
    const personasCol = viewAllCols.find(({ col }) => col.type === "Personas");
    if (viewedViewFilter === "responsible" && viewedSelectedResponsible && personasCol) {
      result = result.filter((task) => {
        const value = readViewedTaskField(task, personasCol.key, personasCol.col, personasCol.kind, personasCol.index);
        if (typeof value === "string") {
          return value.split(",").map(p => p.trim()).includes(viewedSelectedResponsible);
        }
        return false;
      });
    }
    const locationCol = viewAllCols.find(({ col }) => col.type === "Lugar");
    if (viewedViewFilter === "location" && viewedSelectedLocation && locationCol) {
      result = result.filter((task) =>
        getLocationLabel(readViewedTaskField(task, locationCol.key, locationCol.col, locationCol.kind, locationCol.index)) === viewedSelectedLocation
      );
    }
    const activeSortCol = viewAllCols.find(({ col }) => col.sort === "Asc" || col.sort === "Desc");
    if (activeSortCol) {
      result = sortRowsByStoredColumn(
        result,
        viewedTasks,
        activeSortCol.col,
        (task) => readViewedTaskField(task, activeSortCol.key, activeSortCol.col, activeSortCol.kind, activeSortCol.index),
        getLocationLabel,
      );
    }
    return result;
  }, [viewedTasks, viewAllCols, viewedViewFilter, viewedSelectedStatus, viewedSelectedResponsible, viewedSelectedLocation]);

  if (role !== "admin" && role !== "dev") {
    return <div className={`${styles.page} ${poppins.className} ${darkMode ? styles.dark : ""}`}><main className={styles.main}><p style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>Sin permisos.</p></main></div>;
  }

  const renderAreasPicker = () => (
    <div>
      <label className={userModalStyles.fieldLabel}>Áreas</label>
      <p className={userModalStyles.areasHint}>Elige una o más áreas del menú del dashboard.</p>
      <div className={userModalStyles.areaGrid}>
        {DEPARTMENT_AREAS.map((area) => {
          const active = formAreas.includes(area);
          return (
            <button
              key={area}
              type="button"
              className={`${userModalStyles.areaChip} ${active ? userModalStyles.areaChipActive : ""}`}
              onClick={() => toggleFormArea(area)}
              aria-pressed={active}
            >
              {area}
            </button>
          );
        })}
      </div>
    </div>
  );

  const viewActiveTab = viewedTabs.find(t => t.id === viewedActiveTab);
  let viewedShareIncoming: string | null = null;
  let viewedShareOutgoing: string | null = null;
  if (viewActiveTab && viewingUser) {
    if (viewActiveTab.isShared && viewActiveTab.sharedFrom) {
      viewedShareIncoming = viewActiveTab.sharedFrom;
    }
    const out = viewedOutboundSharesByTab[viewActiveTab.id];
    if (out?.length) {
      viewedShareOutgoing = out
        .map((s) => {
          const name = s.shared_with_name?.trim() || s.shared_with_id;
          if (s.status === "pending") return `${name} (invitación pendiente)`;
          return name;
        })
        .join(", ");
    }
  }

  return (
    <div className={`${styles.page} ${poppins.className} ${collapsed ? styles.collapsed : ""} ${darkMode ? styles.dark : ""} ${sidebarRight ? styles.sidebarRight : ""}`}>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <main className={styles.main}>
        <Header showNotifications={showNotifications} setShowNotifications={setShowNotifications} showSettings={showSettings} setShowSettings={setShowSettings} darkMode={darkMode} setDarkMode={setDarkMode} sidebarRight={sidebarRight} setSidebarRight={setSidebarRight} />

        <PageContent>
        {/* ── Vista normal: gestión de usuarios ── */}
        {!viewingUser && (
          <div className={styles.content}>
            <div className={styles.panel} style={{ padding: "24px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><FiUsers /> Gestión de Usuarios</h2>
                {isDev && <button onClick={() => { resetForm(); setShowCreateModal(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}><FiPlus /> Nuevo</button>}
              </div>
              {loading ? <p style={{ color: "var(--text-dim)" }}>Cargando...</p> : (
                <>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>
                  {users.length} usuario{users.length !== 1 ? "s" : ""} en total
                </p>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)", width: 36, textAlign: "center" }}>#</th>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)" }}>Nombre</th>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)" }}>Usuario</th>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)" }}>Rol</th>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)" }}>Creado</th>
                    <th style={{ padding: "8px 10px", color: "var(--text-dim)", textAlign: "right" }}>Acciones</th>
                  </tr></thead>
                  <tbody>{users.map((u, idx) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-dim)", fontWeight: 600, fontSize: 12 }}>{idx + 1}</td>
                      <td style={{ padding: 10 }}>{u.displayName}</td>
                      <td style={{ padding: 10, color: "var(--text-dim)" }}>{u.username}</td>
                      <td style={{ padding: 10 }}><span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${ROLE_COLORS[u.role]}20`, color: ROLE_COLORS[u.role] }}>{ROLE_LABELS[u.role]}</span></td>
                      <td style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: 10, textAlign: "right" }}><div style={{ display: "inline-flex", gap: 6 }}>
                        <button onClick={() => openViewNotions(u)} title="Ver notions" style={{ border: "1px solid var(--border)", borderRadius: 6, background: "transparent", padding: "5px 8px", cursor: "pointer", color: "var(--text)" }}><FiEye /></button>
                        {isDev && <><button onClick={() => openEdit(u)} title="Editar" style={{ border: "1px solid var(--border)", borderRadius: 6, background: "transparent", padding: "5px 8px", cursor: "pointer", color: "var(--text)" }}><FiEdit2 /></button>{u.username !== 'dev' && <button onClick={() => handleDelete(u.id)} title="Eliminar" style={{ border: "1px solid var(--border)", borderRadius: 6, background: "transparent", padding: "5px 8px", cursor: "pointer", color: "#ef4444" }}><FiTrash2 /></button>}</>}
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Vista notion del usuario: reemplaza el content ── */}
        {viewingUser && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

            {/* Tabs bar — igual al del Notion real */}
            <div className={tabChrome.notionTabsBar} style={{ flexShrink: 0, padding: "10px 12px 0 48px" }}>
              {viewedTabs.map((t) => {
                const isSharedWithMe = t.isShared === true;
                const sharedFrom = t.sharedFrom;
                const outbound = viewedOutboundSharesByTab[t.id] ?? [];
                const isSharedByOwner = !isSharedWithMe && outbound.length > 0;
                const recipientsLabel = outbound
                  .map((s) => {
                    const name = s.shared_with_name?.trim() || s.shared_with_id;
                    return s.status === "pending" ? `${name} (pendiente)` : name;
                  })
                  .join(", ");
                const tabShareHint = isSharedWithMe
                  ? `Compartida por ${sharedFrom ?? "otro usuario"}`
                  : isSharedByOwner
                    ? `Compartida con: ${recipientsLabel}`
                    : "";
                return (
                <button
                  key={t.id}
                  type="button"
                  className={t.id === viewedActiveTab ? tabChrome.notionTabActive : tabChrome.notionTab}
                  onClick={() => { setViewedColWidths({}); loadTabData(t.id); }}
                  title={tabShareHint ? `${t.title} · ${tabShareHint}` : t.title}
                >
                  <FiLayers className={tabChrome.notionTabIcon} />
                  <span className={tabChrome.notionTabTitleCluster}>
                    <span className={tabChrome.notionTabTitleText}>{t.title}</span>
                    {isSharedWithMe ? (
                      <span className={tabChrome.notionTabShareIconIn} title={`Compartida por ${sharedFrom ?? "otro usuario"}`}>
                        <FiUserCheck size={11} />
                      </span>
                    ) : null}
                    {isSharedByOwner ? (
                      <span className={tabChrome.notionTabShareIconOut} title={`Compartida con: ${recipientsLabel}`}>
                        <FiShare2 size={11} />
                      </span>
                    ) : null}
                  </span>
                </button>
              );
              })}
              {viewedTabs.length === 0 && <span style={{ padding: "0 16px", color: "var(--text-dim)", fontSize: 13 }}>Sin tablas</span>}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {viewedRefreshedAt && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    Actualizado {viewedRefreshedAt.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
                <button
                  onClick={() => viewedActiveTabRef.current && loadTabData(viewedActiveTabRef.current)}
                  title="Actualizar datos"
                  disabled={viewedRefreshing}
                  style={{ border: "1px solid var(--border)", borderRadius: 6, background: "transparent", padding: "4px 8px", cursor: "pointer", color: "var(--text-dim)", display: "flex", alignItems: "center", opacity: viewedRefreshing ? 0.5 : 1 }}
                >
                  <FiRefreshCw size={13} style={{ animation: viewedRefreshing ? "spin 1s linear infinite" : undefined }} />
                </button>
                <span className={notionStyles.filterChip} style={{ pointerEvents: "none", flexShrink: 0, fontWeight: 600 }}>
                  <FiEye size={12} /> Vista · {viewingUser.displayName}
                </span>
                <div className={notionStyles.exportMenuWrap} data-notion-menu-root>
                  <button
                    type="button"
                    className={notionStyles.gridToggleBtn}
                    title="Exportar tabla"
                    onClick={(event) => {
                      event.stopPropagation();
                      setShowViewExportMenu((v) => !v);
                    }}
                  >
                    <FiDownload /> Exportar
                  </button>
                  {showViewExportMenu ? (
                    <div className={notionStyles.exportMenu} onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => exportViewedTable("xlsx")}>Excel</button>
                      <button type="button" onClick={() => exportViewedTable("csv")}>CSV</button>
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => { setViewingUser(null); setViewedColWidths({}); setViewedOutboundSharesByTab({}); resetViewedFilters(); }}
                  title="Volver a usuarios"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    border: "1px solid rgba(200,50,50,0.35)",
                    borderRadius: 8, background: "rgba(200,50,50,0.07)",
                    color: "#c0392b", padding: "6px 12px",
                    cursor: "pointer", fontSize: 13, fontWeight: 600,
                    transition: "background 120ms ease",
                  }}
                >
                  <FiX size={14} />
                </button>
              </div>
            </div>

            {/* Cuerpo scrolleable */}
            <div className={notionStyles.notionPanelScroll} style={{ flex: 1 }}>
              <div className={notionStyles.notionScrollInner}>
              {/* Título */}
              <div className={notionStyles.notionPanelHeader} style={{ padding: "28px 48px 0" }}>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                  {viewActiveTab?.title || "Sin título"}
                </h1>
              </div>

              {/* Info chips */}
              <div className={notionStyles.filterBar} style={{ paddingLeft: 48, flexShrink: 0 }}>
                {viewedShareIncoming ? (
                  <span
                    className={notionStyles.filterChip}
                    style={{
                      pointerEvents: "none",
                      borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))",
                      background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                      color: "var(--accent)",
                      fontWeight: 600,
                      maxWidth: 340,
                      overflow: "hidden",
                    }}
                    title={`Tabla recibida por ${viewingUser.displayName}, compartida por ${viewedShareIncoming}`}
                  >
                    <FiUserCheck size={12} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Recibida · {viewedShareIncoming}
                    </span>
                  </span>
                ) : null}
                {viewedShareOutgoing ? (
                  <span
                    className={notionStyles.filterChip}
                    style={{
                      pointerEvents: "none",
                      borderColor: "var(--border)",
                      background: "color-mix(in srgb, var(--text-dim) 8%, transparent)",
                      color: "var(--text-dim)",
                      fontWeight: 600,
                      maxWidth: 340,
                      overflow: "hidden",
                    }}
                    title={`Compartida con: ${viewedShareOutgoing}`}
                  >
                    <FiShare2 size={12} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Compartida · {viewedShareOutgoing}
                    </span>
                  </span>
                ) : null}
                <span className={notionStyles.filterChip} style={{ pointerEvents: "none" }}>
                  <FiLayers size={12} />{" "}
                  {filteredViewedTasks.length} registro{filteredViewedTasks.length !== 1 ? "s" : ""}
                  {viewedViewFilter !== "all" && filteredViewedTasks.length !== viewedTasks.length
                    ? ` de ${viewedTasks.length}`
                    : ""}
                </span>
                {viewedTasks.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className={viewedViewFilter === "all" ? notionStyles.filterChipActive : notionStyles.filterChip}
                      onClick={resetViewedFilters}
                    >
                      <FiCheckCircle size={12} /> Todas las tareas
                    </button>
                    {viewAllCols.some(c => c.col.type === "Estado") ? (
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          className={viewedViewFilter === "status" ? notionStyles.filterChipActive : notionStyles.filterChip}
                          onClick={() => {
                            if (viewedViewFilter === "status") {
                              setShowViewedFilterMenu(!showViewedFilterMenu);
                            } else {
                              setViewedViewFilter("status");
                              setShowViewedFilterMenu(true);
                            }
                          }}
                        >
                          <FiLayers size={12} /> Por estado{viewedSelectedStatus ? `: ${viewedSelectedStatus}` : ""}
                        </button>
                        {viewedViewFilter === "status" && showViewedFilterMenu ? (() => {
                          const statusCol = viewAllCols.find(({ col }) => col.type === "Estado");
                          const statusesFromTasks = new Set<string>();
                          if (statusCol) {
                            viewedTasks.forEach((task) => {
                              const value = readViewedTaskField(task, statusCol.key, statusCol.col, statusCol.kind, statusCol.index);
                              if (typeof value === "string" && value.trim()) statusesFromTasks.add(value.trim());
                            });
                          }
                          const predefined = statusCol?.col.options || [];
                          const allStatuses = Array.from(new Set([...predefined, ...statusesFromTasks])).sort();
                          return (
                            <div className={notionStyles.viewFilterDropdown}>
                              <button
                                type="button"
                                className={!viewedSelectedStatus ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => { setViewedSelectedStatus(null); setShowViewedFilterMenu(false); }}
                              >
                                Todos los estados
                              </button>
                              {allStatuses.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  className={viewedSelectedStatus === status ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => { setViewedSelectedStatus(status); setShowViewedFilterMenu(false); }}
                                >
                                  {status}
                                </button>
                              ))}
                            </div>
                          );
                        })() : null}
                      </div>
                    ) : null}
                    {viewAllCols.some(c => c.col.type === "Personas") ? (
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          className={viewedViewFilter === "responsible" ? notionStyles.filterChipActive : notionStyles.filterChip}
                          onClick={() => {
                            if (viewedViewFilter === "responsible") {
                              setShowViewedFilterMenu(!showViewedFilterMenu);
                            } else {
                              setViewedViewFilter("responsible");
                              setShowViewedFilterMenu(true);
                            }
                          }}
                        >
                          <FiUser size={12} /> Responsable{viewedSelectedResponsible ? `: ${viewedSelectedResponsible}` : ""}
                        </button>
                        {viewedViewFilter === "responsible" && showViewedFilterMenu ? (() => {
                          const personasCol = viewAllCols.find(({ col }) => col.type === "Personas");
                          const peopleFromTasks = new Set<string>();
                          if (personasCol) {
                            viewedTasks.forEach((task) => {
                              const value = readViewedTaskField(task, personasCol.key, personasCol.col, personasCol.kind, personasCol.index);
                              if (typeof value === "string" && value.trim()) {
                                value.split(",").map(p => p.trim()).filter(Boolean).forEach(p => peopleFromTasks.add(p));
                              }
                            });
                          }
                          const predefined = personasCol?.col.options || [];
                          const allPeople = Array.from(new Set([...predefined, ...peopleFromTasks])).sort();
                          return (
                            <div className={notionStyles.viewFilterDropdown}>
                              <button
                                type="button"
                                className={!viewedSelectedResponsible ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => { setViewedSelectedResponsible(null); setShowViewedFilterMenu(false); }}
                              >
                                Todos los responsables
                              </button>
                              {allPeople.map((person) => (
                                <button
                                  key={person}
                                  type="button"
                                  className={viewedSelectedResponsible === person ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => { setViewedSelectedResponsible(person); setShowViewedFilterMenu(false); }}
                                >
                                  {person}
                                </button>
                              ))}
                            </div>
                          );
                        })() : null}
                      </div>
                    ) : null}
                    {viewAllCols.some(c => c.col.type === "Lugar") ? (
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          className={viewedViewFilter === "location" ? notionStyles.filterChipActive : notionStyles.filterChip}
                          onClick={() => {
                            if (viewedViewFilter === "location") {
                              setShowViewedFilterMenu(!showViewedFilterMenu);
                            } else {
                              setViewedViewFilter("location");
                              setShowViewedFilterMenu(true);
                            }
                          }}
                        >
                          <FiMapPin size={12} /> Lugar{viewedSelectedLocation ? `: ${viewedSelectedLocation}` : ""}
                        </button>
                        {viewedViewFilter === "location" && showViewedFilterMenu ? (() => {
                          const locationCol = viewAllCols.find(({ col }) => col.type === "Lugar");
                          const locationsFromTasks = new Set<string>();
                          if (locationCol) {
                            viewedTasks.forEach((task) => {
                              const label = getLocationLabel(readViewedTaskField(task, locationCol.key, locationCol.col, locationCol.kind, locationCol.index)).trim();
                              if (label) locationsFromTasks.add(label);
                            });
                          }
                          const predefined = locationCol?.col.options || [];
                          const allLocations = Array.from(new Set([...predefined, ...locationsFromTasks])).sort();
                          return (
                            <div className={notionStyles.viewFilterDropdown}>
                              <button
                                type="button"
                                className={!viewedSelectedLocation ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => { setViewedSelectedLocation(null); setShowViewedFilterMenu(false); }}
                              >
                                Todos los lugares
                              </button>
                              {allLocations.map((location) => (
                                <button
                                  key={location}
                                  type="button"
                                  className={viewedSelectedLocation === location ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => { setViewedSelectedLocation(location); setShowViewedFilterMenu(false); }}
                                >
                                  {location}
                                </button>
                              ))}
                            </div>
                          );
                        })() : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              {/* Tabla */}
              <div className={notionStyles.notionPanelBody} style={{ paddingBottom: 40 }}>
                {viewedTasks.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", gap: 12, color: "var(--text-dim)" }}>
                    <FiLayers size={36} style={{ opacity: 0.25 }} />
                    <p style={{ fontSize: 14, margin: 0 }}>Sin registros en esta tabla</p>
                  </div>
                ) : filteredViewedTasks.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", gap: 12, color: "var(--text-dim)" }}>
                    <FiLayers size={36} style={{ opacity: 0.25 }} />
                    <p style={{ fontSize: 14, margin: 0 }}>Ningún registro coincide con el filtro</p>
                    <button type="button" onClick={resetViewedFilters} className={notionStyles.filterChip} style={{ marginTop: 4 }}>
                      <FiCheckCircle size={12} /> Ver todas las tareas
                    </button>
                  </div>
                ) : (
                  <table className={notionStyles.notionTable} style={{ marginLeft: 48 }}>
                    <thead>
                      <tr>
                        <th className={notionStyles.rowSelectorHeader} />
                        {/* Columnas dinámicas — redimensionables */}
                        {viewAllCols.map(({ col }) => {
                          const colKey = col.id || col.title;
                          const defaultW = col.width ?? 140;
                          const w = viewedColWidths[colKey] ?? defaultW;
                          return (
                            <th
                              key={colKey}
                              className={`${notionStyles.customColumnHeader} ${notionStyles.baseColumnHeader}`}
                              style={{ position: "relative", width: w, minWidth: w }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                {COL_ICONS[isAutoIdColumn(col) ? "ID" : col.type] || <FiType size={12} />}
                                {isAutoIdColumn(col) ? getIdColumnLabel(col) : col.title}
                              </span>
                              <div
                                className={notionStyles.columnResizeHandle}
                                onMouseDown={e => { e.preventDefault(); startResize(colKey, e.clientX, w); }}
                              />
                            </th>
                          );
                        })}
                        <th style={{ minWidth: 32, border: "1px solid var(--border)" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredViewedTasks.map((task, i) => (
                        <tr key={`vt-${i}-${String(task["id"] ?? "")}`}>
                          <td className={notionStyles.rowSelectorCell} />
                          {viewAllCols.map(({ col, key, kind, index }) => {
                            const colKey = col.id || col.title;
                            const w = viewedColWidths[colKey] ?? (col.width ?? 140);
                            const cellValue = readViewedTaskField(task, key, col, kind, index);
                            return (
                              <td
                                key={colKey}
                                style={{ padding: "6px 10px", borderRight: "1px solid var(--border)", width: w, maxWidth: w, overflow: "hidden", wordBreak: "break-word" }}
                              >
                                {renderNotionCell(
                                  isAutoIdColumn(col) ? getAutoIdValue(i) : cellValue,
                                  isAutoIdColumn(col) ? "ID" : col.type,
                                  col.optionColors,
                                  {
                                  onFechaClick: () => {
                                    setShowCalendar(true);
                                  },
                                })}
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                      ))}
                      <tr className={notionStyles.addRowLine}>
                        <td colSpan={viewAllCols.length + 2}>
                          <span style={{ paddingLeft: 54, color: "var(--text-dim)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <FiPlus size={13} />
                            {filteredViewedTasks.length} registro{filteredViewedTasks.length !== 1 ? "s" : ""}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
              </div>
            </div>
          </div>
        )}
        </PageContent>
      </main>


      {showCreateModal && (
        <div className={userModalStyles.userModalOverlay} onClick={() => { if (!formSaving) setShowCreateModal(false); }}>
          <div className={userModalStyles.userModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={userModalStyles.userModalTitle}>Crear usuario</h3>
            <div className={userModalStyles.fieldStack}>
              <div>
                <label className={userModalStyles.fieldLabel}>Usuario</label>
                <input className={userModalStyles.input} value={formUsername} onChange={(e) => setFormUsername(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Nombre para mostrar</label>
                <input className={userModalStyles.input} value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Contraseña</label>
                <input className={userModalStyles.input} type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Rol</label>
                <select className={userModalStyles.input} value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)}>
                  <option value="user">Usuario</option>
                  <option value="admin">Admin</option>
                  <option value="dev">Dev</option>
                </select>
              </div>
              {renderAreasPicker()}
              {formError && <p className={userModalStyles.modalError}>{formError}</p>}
              <div className={userModalStyles.modalActions}>
                <button type="button" className={userModalStyles.btnGhost} disabled={formSaving} onClick={() => { setShowCreateModal(false); resetForm(); }}>Cancelar</button>
                <button type="button" className={userModalStyles.btnPrimary} disabled={formSaving} onClick={() => void handleCreate()}>
                  {formSaving ? "Creando…" : "Crear"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className={userModalStyles.userModalOverlay} onClick={() => { if (!formSaving) setEditingUser(null); }}>
          <div className={userModalStyles.userModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={userModalStyles.userModalTitle}>Editar usuario</h3>
            <div className={userModalStyles.fieldStack}>
              <div>
                <label className={userModalStyles.fieldLabel}>Usuario</label>
                <input className={userModalStyles.input} value={formUsername} onChange={(e) => setFormUsername(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Nombre</label>
                <input className={userModalStyles.input} value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Nueva contraseña</label>
                <input className={userModalStyles.input} type="password" placeholder="Vacío = sin cambio" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <div>
                <label className={userModalStyles.fieldLabel}>Rol</label>
                <select className={userModalStyles.input} value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)}>
                  <option value="user">Usuario</option>
                  <option value="admin">Admin</option>
                  <option value="dev">Dev</option>
                </select>
              </div>
              {renderAreasPicker()}
              {formError && <p className={userModalStyles.modalError}>{formError}</p>}
              <div className={userModalStyles.modalActions}>
                <button type="button" className={userModalStyles.btnGhost} disabled={formSaving} onClick={() => setEditingUser(null)}>Cancelar</button>
                <button type="button" className={userModalStyles.btnPrimary} disabled={formSaving} onClick={() => void handleUpdate()}>
                  {formSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
