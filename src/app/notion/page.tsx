"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from "react";
import ReactDOM from "react-dom";
import {
  FiBookmark,
  FiBook,
  FiLayers,
  FiPlus,
  FiSearch,
  FiType,
  FiHash,
  FiCheckCircle,
  FiCalendar,
  FiUsers,
  FiPaperclip,
  FiLink,
  FiMail,
  FiPhone,
  FiArrowUpRight,
  FiArrowLeft,
  FiArrowRight,
  FiArrowUp,
  FiArrowDown,
  FiCopy,
  FiMapPin,
  FiClock,
  FiUser,
  FiTrash2,
  FiEye,
  FiEyeOff,
  FiSliders,
  FiMoreVertical,
  FiMoreHorizontal,
  FiDownload,
  FiShare2,
  FiUserCheck,
  FiRotateCcw,
} from "react-icons/fi";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { poppins } from "@/fonts";
import styles from "../page.module.css";
import notionStyles from "./page.module.css";
import tabChrome from "./notionChrome.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { LocationInput } from "../../components/LocationInput";
import { DateInput } from "../../components/DateInput";
import { SelectInput } from "../../components/SelectInput";
import { FileInput } from "../../components/FileInput";
import { AttachmentSummary } from "../../components/AttachmentDisplay";
import type { AttachmentValue } from "@/lib/attachments";
import { uploadNotionAttachments } from "@/lib/uploadNotionAttachment";
import { PhoneInput } from "../../components/PhoneInput";
import { useTasks, type Task } from "@/hooks/useTasks";
import { useColumns, type Column } from "@/hooks/useColumns";
import { useNotionTabs, type NotionTab } from "@/hooks/useNotionTabs";
import { usePageShell } from "@/hooks/usePageShell";
import { useAuthSession } from "@/components/AuthGate";
import { resolveUsersApi, resolveSharesApi } from "@/utils/api";
import { sortRowsByStoredColumn } from "@/lib/notionColumnUtils";
import { mergeNotionTasks, syncNotionTasksFromServer } from "@/lib/mergeNotionTasks";
import { shouldCreatePreDeleteRevision, type HistoryUserMeta } from "@/lib/notionHistory";
import { useNotionHistory } from "@/hooks/useNotionHistory";
import { useSnackbar } from "@/hooks/useSnackbar";
import { NotionHistoryPanel } from "@/components/NotionHistoryPanel";
import { SnackbarStack } from "@/components/SnackbarStack";
import {
  COLOR_PRESETS,
  DEFAULT_STATUS_COLORS as defaultStatusColors,
  normalizeToPresetColor,
  optionChipStyle,
  paletteColorFor,
  resolveOptionHexColor,
} from "@/lib/notionOptionColors";
import { DEPARTMENT_AREAS, sanitizeDepartmentAreas } from "@/lib/departments";

type FieldMeta = {
  key: string;
  label: string;
  type: string;
  kind: "base" | "custom";
  index: number;
  options?: string[];
  legacyKeys?: string[];
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function mergePersonasVariables(systemNames: string[], saved: string[] = []): string[] {
  const custom = saved.filter((name) => !systemNames.includes(name));
  return [...systemNames, ...custom].sort((a, b) => a.localeCompare(b, "es"));
}

function mergeAreasVariables(systemAreas: string[], saved: string[] = []): string[] {
  const custom = saved.filter((area) => !systemAreas.includes(area));
  return [...systemAreas, ...custom].sort((a, b) => a.localeCompare(b, "es"));
}

function isAreaRelationColumn(column: { type?: string; savedTitle?: string }, kind: "base" | "custom"): boolean {
  return column.type === "Relación" && (kind === "base" || column.savedTitle === "Área");
}

const defaultStatusOptions = ["Sin empezar", "Listo", "Completado"];

const getLocationDisplayLabel = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const location = value as { label?: unknown; display_name?: unknown; query?: unknown; name?: unknown };
    return String(location.label || location.display_name || location.query || location.name || "");
  }
  return String(value);
};

const isValidEmail = (value: unknown) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isValidUrl = (value: unknown) =>
  typeof value === "string" && /^https?:\/\/.+\..+/.test(value.trim());

const isCheckboxChecked = (value: unknown) =>
  value === true || value === "true" || value === "1" || value === "✓" || value === "sí" || value === "si";

const getBaseFieldKey = (savedTitle: string) => {
  if (savedTitle === "Usuario") return "usuario";
  if (savedTitle === "Área") return "area";
  if (savedTitle === "Actividad") return "actividad";
  if (savedTitle === "Lugar") return "lugar";
  if (savedTitle === "Fecha") return "fecha";
  if (savedTitle === "Casilla") return "casilla";
  if (savedTitle === "Estado") return "estado";
  return null;
};

const getColumnFieldKey = (column: Column, index: number, kind: "base" | "custom") => {
  const persistedFieldKey = (column as Column & { fieldKey?: string }).fieldKey;
  if (persistedFieldKey) return persistedFieldKey;
  if (kind === "base") {
    // Primero por savedTitle, luego por type (ej: "Fecha límite" con type "Fecha" → "fecha")
    const mapped = getBaseFieldKey(column.savedTitle) || getBaseFieldKey(column.type || "");
    if (mapped) return mapped;
    if (column.id) return column.id;
    return `base_${slugify(column.savedTitle || column.title || "field")}_${index + 1}`;
  }
  if (column.type === "Fecha de creación") return "createdAt";
  if (column.type === "Última edición") return "updatedAt";
  if (column.type === "Creado por") return "createdBy";
  if (column.type === "Última edición por") return "lastEditedBy";
  return column.id || `custom_${slugify(column.type || column.title || "column")}_${index + 1}`;
};

const getCustomFieldMeta = (column: Column, index: number): FieldMeta => {
  const normalized = getColumnFieldKey(column, index, "custom");
  
  const legacyByType = `custom_${slugify(column.type || column.title || "column")}_${index}`;
  const legacyByTitle = `custom_${slugify(column.title || column.type || "column")}_${index}`;
  const legacyKeys = [legacyByType, legacyByTitle].filter((key, pos, arr) => key !== normalized && arr.indexOf(key) === pos);

  return {
    key: normalized,
    label: column.title,
    type: column.type,
    kind: "custom",
    index,
    options: Array.isArray(column.options) ? column.options : [],
    legacyKeys,
  };
};

const readTaskField = (task: Task, field: FieldMeta): unknown => {
  if (Object.prototype.hasOwnProperty.call(task, field.key)) {
    return task[field.key];
  }
  for (const key of field.legacyKeys || []) {
    if (task[key] !== undefined) {
      return task[key];
    }
  }
  return "";
};

const toDateInputValue = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const monthMap: Record<string, number> = {
    enero: 0,
    febrero: 1,
    marzo: 2,
    abril: 3,
    mayo: 4,
    junio: 5,
    julio: 6,
    agosto: 7,
    septiembre: 8,
    setiembre: 8,
    octubre: 9,
    noviembre: 10,
    diciembre: 11,
  };
  const match = raw.match(/^(\d{1,2}) de ([a-záéíóúñ]+) de (\d{4})$/i);
  if (match) {
    const day = Number(match[1]);
    const month = monthMap[match[2].toLowerCase()];
    const year = Number(match[3]);
    if (month !== undefined) {
      const date = new Date(year, month, day);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const formatDateForDisplay = (value: unknown): string => {
  const iso = toDateInputValue(value);
  if (!iso) return typeof value === "string" ? value : "";
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const parseMultiSelectValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(";")
      .flatMap((part) => part.split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeAttachmentList = (value: unknown): AttachmentValue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const attachment = item as Partial<AttachmentValue>;
      if (!attachment.name || (!attachment.dataUrl && !attachment.url && !attachment.hasData)) return null;
      return {
        name: String(attachment.name),
        type: String(attachment.type || "application/octet-stream"),
        size: Number(attachment.size || 0),
        ...(attachment.id ? { id: String(attachment.id) } : {}),
        ...(attachment.dataUrl ? { dataUrl: String(attachment.dataUrl) } : {}),
        ...(attachment.url ? { url: String(attachment.url) } : {}),
        ...(attachment.hasData ? { hasData: true } : {}),
      } as AttachmentValue;
    })
    .filter((item): item is AttachmentValue => Boolean(item));
};

function computeNotionTabHoverIndex(clientX: number, orderedIds: string[], bar: HTMLElement): number {
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const el = bar.querySelector(`[data-notion-tab-id="${CSS.escape(id)}"]`);
    const r = el?.getBoundingClientRect();
    if (!r || r.width === 0) continue;
    if (clientX < r.left + r.width / 2) return i;
  }
  return orderedIds.length;
}

export default function NotionPage() {
  const { showNotifications, setShowNotifications, showSettings, setShowSettings, darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = usePageShell();
  const auth = useAuthSession();
  const { snackbars, showSnackbar } = useSnackbar();
  const historyMeta = useMemo<HistoryUserMeta | undefined>(() => {
    if (!auth.user?.id) return undefined;
    return {
      userId: auth.user.id,
      userName: auth.user.displayName ?? auth.user.username ?? "",
    };
  }, [auth.user?.id, auth.user?.displayName, auth.user?.username]);

  const { tabs: notionTabs, trash: notionTrash, activeTabId, setActiveTabId, loading: tabsLoading, createTab, renameTab, deleteTab, restoreTab, permanentDeleteTab, reorderTabs, duplicateTab, setTabPinned } = useNotionTabs(auth.user?.id);
  const { tasks, loading: tasksLoading, loadedForTabId: tasksLoadedForTabId, refreshTasks, addTask, updateTask, deleteTask, reorderTasks, patchTaskLocal } = useTasks(activeTabId, historyMeta);
  const { baseColumns: initialBaseColumns, customColumns: initialCustomColumns, loading: columnsLoading, loadedForTabId: columnsLoadedForTabId, refreshColumns, saveColumns } = useColumns(activeTabId, historyMeta);
  const {
    data: historyData,
    loading: historyLoading,
    refresh: refreshHistory,
    createManualRevision,
    createStableCheckpoint,
    createPreBulkDeleteRevision,
    applyRevision,
    restoreLatestRevision,
  } = useNotionHistory(auth.user?.id, historyMeta?.userName);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [visibilitySearch, setVisibilitySearch] = useState("");
  const [activeColumnMenu, setActiveColumnMenu] = useState<{ kind: "base" | "custom"; index: number } | null>(null);
  const [propertyMenuPosition, setPropertyMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<{ kind: "base" | "custom"; index: number } | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<{ kind: "base" | "custom"; index: number; side: "before" | "after" } | null>(null);
  const [baseColumns, setBaseColumns] = useState<Column[]>([]);
  const [customColumns, setCustomColumns] = useState<Column[]>([]);
  const [openSubmenu, setOpenSubmenu] = useState<"sort" | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; key: string } | null>(null);
  const [rows, setRows] = useState<Task[]>([]);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [duplicateError, setDuplicateError] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [highlightGrid, setHighlightGrid] = useState(true);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [tableTitle, setTableTitle] = useState("Actividades Planificadas");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [showTrashPanel, setShowTrashPanel] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const lastTableChangeRef = useRef(Date.now());
  const stableCheckpointSentRef = useRef(false);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const activeNotionTab = notionTabs.find((tab) => tab.id === activeTabId);
  type ViewFilterKind = "status" | "responsible" | "location" | "checkbox";
  const [openFilterMenu, setOpenFilterMenu] = useState<ViewFilterKind | null>(null);
  const [notionTabMenu, setNotionTabMenu] = useState<{ tabId: string; left: number; top: number } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState(0);
  const hasOpenFloatingMenu = showColumnMenu || showVisibilityMenu || showExportMenu || openFilterMenu !== null || Boolean(notionTabMenu);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedResponsible, setSelectedResponsible] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedCheckbox, setSelectedCheckbox] = useState<boolean | null>(null);
  const hasActiveViewFilters =
    selectedStatus !== null ||
    selectedResponsible !== null ||
    selectedLocation !== null ||
    selectedCheckbox !== null;

  const clearAllViewFilters = useCallback(() => {
    setSelectedStatus(null);
    setSelectedResponsible(null);
    setSelectedLocation(null);
    setSelectedCheckbox(null);
    setOpenFilterMenu(null);
  }, []);
  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null);
  const addColumnButtonRef = useRef<HTMLButtonElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const notionTabsRef = useRef<NotionTab[]>([]);
  const reorderTabsRef = useRef(reorderTabs);
  const tabDragRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    tabId: string | null;
    startX: number;
    startY: number;
    pointerId: number | null;
    el: HTMLButtonElement | null;
  }>({ timer: null, tabId: null, startX: 0, startY: 0, pointerId: null, el: null });
  const draggingTabIdRef = useRef<string | null>(null);
  const dragHoverIndexRef = useRef(0);
  const suppressNextTabClickRef = useRef(false);
  const lastSyncedTitleRef = useRef("");
  const renameDirtyRef = useRef(false);
  const loadedTasksTabRef = useRef<string | undefined>(undefined);
  const forceTasksReplaceRef = useRef(false);
  const attachmentSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const attachmentSavePayloadRef = useRef<Map<string, { taskId: string; fieldKey: string; legacyKeys: string[]; value: unknown; editorName: string }>>(new Map());
  const fieldSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fieldSavePayloadRef = useRef<Map<string, { taskId: string; patch: Partial<Task> }>>(new Map());
  notionTabsRef.current = notionTabs;
  reorderTabsRef.current = reorderTabs;

  // Usuarios del sistema (con áreas) para la lógica de auto-fill de Relación
  const [systemUsers, setSystemUsers] = useState<Array<{ id: string; username: string; displayName: string; areas: string[] }>>([]);
  const [areaPicker, setAreaPicker] = useState<{ rowIdx: number; relacionField: FieldMeta; personName: string; options: string[] } | null>(null);

  // Panel de gestión de Personas ↔ Áreas (solo admin/dev)
  const [showAreasPanel, setShowAreasPanel] = useState(false);
  // Compartir Notion
  const [showShareModal, setShowShareModal]   = useState(false);
  const [shareTargetTab, setShareTargetTab]   = useState<{ id: string; title: string } | null>(null);
  const [shareSelectedUser, setShareSelectedUser] = useState<{ id: string; displayName: string } | null>(null);
  const [shareLoading, setShareLoading]       = useState(false);
  const [shareSuccess, setShareSuccess]       = useState(false);
  const [tabShares, setTabShares]             = useState<Array<{ shared_with_id: string; shared_with_name?: string; status: string }>>([]);
  /** Shares que yo envío, agrupados por tab_id (para UI por pestaña) */
  const [outboundSharesByTab, setOutboundSharesByTab] = useState<
    Record<string, Array<{ shared_with_id: string; shared_with_name?: string; status: string }>>
  >({});
  const [outboundSharesLoaded, setOutboundSharesLoaded] = useState(false);
  // Compartidos conmigo
  const [showSharedWithMe, setShowSharedWithMe] = useState(false);
  const [sharedWithMeList, setSharedWithMeList] = useState<Array<{ id: string; tab_id: string; tab_title: string; owner_id: string; owner_name?: string; status: string }>>([]);
  const [sharedWithMeLoading, setSharedWithMeLoading] = useState(false);
  const [reopenLoading, setReopenLoading]       = useState<string | null>(null);
  const [areasEditUser, setAreasEditUser] = useState<string | null>(null); // id del usuario en edición
  const [areasLoading, setAreasLoading] = useState(false);

  const refreshOutboundSharesByTab = useCallback(async () => {
    const uid = auth.user?.id;
    if (!uid) {
      setOutboundSharesByTab({});
      setOutboundSharesLoaded(false);
      return;
    }
    try {
      const res = await fetch(`${resolveSharesApi()}?userId=${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list)) return;
      const byTab: Record<string, Array<{ shared_with_id: string; shared_with_name?: string; status: string }>> = {};
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as { owner_id?: string; tab_id?: string; shared_with_id?: string; shared_with_name?: string; status?: string };
        if (row.owner_id !== uid || row.status === "declined" || !row.tab_id || !row.shared_with_id) continue;
        const tid = row.tab_id;
        if (!byTab[tid]) byTab[tid] = [];
        byTab[tid].push({
          shared_with_id: row.shared_with_id,
          shared_with_name: row.shared_with_name,
          status: String(row.status || ""),
        });
      }
      setOutboundSharesByTab(byTab);
      setOutboundSharesLoaded(true);
    } catch {
      /* noop */
    }
  }, [auth.user?.id]);

  const syncSharesForTab = useCallback(async (tabId: string) => {
    const uid = auth.user?.id;
    if (!uid || !tabId) return;
    try {
      const res = await fetch(
        `${resolveSharesApi()}?userId=${encodeURIComponent(uid)}&tabId=${encodeURIComponent(tabId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setOutboundSharesByTab((prev) => ({ ...prev, [tabId]: [] }));
        if (tabId === activeTabId) setTabShares([]);
        return;
      }
      const list = await res.json();
      const mapped = Array.isArray(list)
        ? list
            .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object")
            .map((row) => ({
              shared_with_id: String(row.shared_with_id ?? ""),
              shared_with_name: typeof row.shared_with_name === "string" ? row.shared_with_name : undefined,
              status: String(row.status ?? ""),
            }))
            .filter((s) => s.shared_with_id && s.status !== "declined")
        : [];
      setOutboundSharesByTab((prev) => ({ ...prev, [tabId]: mapped }));
      if (tabId === activeTabId) setTabShares(mapped);
    } catch {
      setOutboundSharesByTab((prev) => ({ ...prev, [tabId]: [] }));
      if (tabId === activeTabId) setTabShares([]);
    }
  }, [auth.user?.id, activeTabId]);

  const notionPinnedCount = useMemo(() => notionTabs.filter((t) => t.pinned === true).length, [notionTabs]);

  const activeShareChips = useMemo(() => {
    if (!activeTabId || !activeNotionTab) return { incoming: null as string | null, outgoing: null as string | null };
    let incoming: string | null = null;
    if (activeNotionTab.isShared && activeNotionTab.sharedFrom) {
      incoming = activeNotionTab.sharedFrom;
    }
    const out = outboundSharesByTab[activeTabId];
    let outgoing: string | null = null;
    if (out?.length) {
      outgoing = out
        .map((s) => {
          const name = s.shared_with_name?.trim() || s.shared_with_id;
          if (s.status === "pending") return `${name} (invitación pendiente)`;
          return name;
        })
        .join(", ");
    }
    return { incoming, outgoing };
  }, [activeTabId, activeNotionTab, outboundSharesByTab]);

  const sharesForShareModal = useMemo(() => {
    if (!shareTargetTab) return [];
    const tid = shareTargetTab.id;
    if (Object.prototype.hasOwnProperty.call(outboundSharesByTab, tid)) {
      return outboundSharesByTab[tid] ?? [];
    }
    if (outboundSharesLoaded) return [];
    if (tid === activeTabId) return tabShares;
    return [];
  }, [shareTargetTab, outboundSharesByTab, outboundSharesLoaded, activeTabId, tabShares]);

  const getIconForType = (type: string): ReactNode => {
    const iconMap: { [key: string]: ReactNode } = {
      "Personas": <FiUsers />,
      "Texto": <FiType />,
      "Número": <FiHash />,
      "Seleccionar": <FiCheckCircle />,
      "Selección múltiple": <FiBook />,
      "Estado": <FiLayers />,
      "Fecha": <FiCalendar />,
      "Archivos y multimedia": <FiPaperclip />,
      "Casilla": <FiCheckCircle />,
      "URL": <FiLink />,
      "Teléfono": <FiPhone />,
      "Correo electrónico": <FiMail />,
      "Relación": <FiArrowUpRight />,
      "ID": <FiHash />,
      "Lugar": <FiMapPin />,
      "Fecha de creación": <FiClock />,
      "Última edición": <FiClock />,
      "Creado por": <FiUser />,
      "Última edición por": <FiUser />,
    };
    return iconMap[type] || <FiType />;
  };

  useEffect(() => {
    if (activeNotionTab?.title) {
      setTableTitle(activeNotionTab.title);
      lastSyncedTitleRef.current = activeNotionTab.title;
      renameDirtyRef.current = false;
    }
  }, [activeTabId, activeNotionTab?.title]);

  const handleCreateNotionTab = async () => {
    try {
      await createTab();
      setActiveColumnMenu(null);
      setSelectedRows([]);
      setActiveFilters([]);
      clearAllViewFilters();
    } catch (err) {
      console.error("Error creando pestaña:", err);
    }
  };

  const flushRenameNotionTab = useCallback((title: string) => {
    if (!activeTabId || title === lastSyncedTitleRef.current) return;
    renameTab(activeTabId, title)
      .then(() => {
        lastSyncedTitleRef.current = title;
        renameDirtyRef.current = false;
      })
      .catch((err) => console.error("Error renombrando pestaña:", err));
  }, [activeTabId, renameTab]);

  const handleRenameNotionTab = (title: string) => {
    setTableTitle(title);
    renameDirtyRef.current = true;
  };

  useEffect(() => {
    if (!activeTabId || !renameDirtyRef.current) return;
    if (tableTitle === lastSyncedTitleRef.current) return;
    const timer = window.setTimeout(() => flushRenameNotionTab(tableTitle), 450);
    return () => window.clearTimeout(timer);
  }, [activeTabId, tableTitle, flushRenameNotionTab]);

  const handleDeleteNotionTab = (tabId: string) => {
    const tab = notionTabs.find((t) => t.id === tabId);
    setDeleteConfirm({ id: tabId, title: tab?.title || "Sin título" });
  };

  const openShareModal = (tab: { id: string; title: string }) => {
    setShareTargetTab(tab);
    setShareSelectedUser(null);
    setShareSuccess(false);
    setShowShareModal(true);
    void syncSharesForTab(tab.id);
  };

  const handleShareTab = async () => {
    if (!shareTargetTab || !shareSelectedUser || !auth.user?.id) return;
    setShareLoading(true);
    try {
      const res = await fetch(resolveSharesApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabId: shareTargetTab.id,
          tabTitle: shareTargetTab.title,
          ownerId: auth.user.id,
          sharedWithId: shareSelectedUser.id,
          ownerDisplayName: auth.user.displayName,
        }),
      });
      if (res.ok || res.status === 409) {
        setShareSuccess(true);
        await syncSharesForTab(shareTargetTab.id);
        await refreshOutboundSharesByTab();
        setTimeout(() => setShowShareModal(false), 1500);
      }
    } catch { /* noop */ } finally {
      setShareLoading(false);
    }
  };

  const openSharedWithMe = async () => {
    if (!auth.user?.id) return;
    setShowSharedWithMe(true);
    setSharedWithMeLoading(true);
    try {
      const res = await fetch(`${resolveSharesApi()}?userId=${encodeURIComponent(auth.user.id)}&received=1`);
      if (res.ok) setSharedWithMeList(await res.json());
    } catch { /* noop */ } finally {
      setSharedWithMeLoading(false);
    }
  };

  const handleReopenTab = async (shareId: string) => {
    if (!auth.user?.id) return;
    setReopenLoading(shareId);
    try {
      const res = await fetch(resolveSharesApi(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, userId: auth.user.id, action: "reopen" }),
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("notion-tabs-updated"));
        setShowSharedWithMe(false);
      }
    } catch { /* noop */ } finally {
      setReopenLoading(null);
    }
  };

  const confirmDeleteNotionTab = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteTab(deleteConfirm.id);
      setSelectedRows([]);
      setActiveFilters([]);
      clearAllViewFilters();
    } catch (err) {
      console.error("Error eliminando pestaña:", err);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleRestoreTab = async (tabId: string) => {
    try {
      await restoreTab(tabId);
      setShowTrashPanel(false);
    } catch (err) {
      console.error("Error restaurando pestaña:", err);
    }
  };

  const handlePermanentDelete = (tabId: string) => {
    const tab = notionTrash.find((t) => t.id === tabId);
    setPermanentDeleteConfirm({ id: tabId, title: tab?.title || "Sin título" });
  };

  const confirmPermanentDelete = async () => {
    if (!permanentDeleteConfirm) return;
    try {
      await permanentDeleteTab(permanentDeleteConfirm.id);
    } catch (err) {
      console.error("Error eliminando permanentemente:", err);
    } finally {
      setPermanentDeleteConfirm(null);
    }
  };

  useEffect(() => {
    const dragState = tabDragRef.current;
    return () => {
      const t = dragState.timer;
      if (t) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!notionTabMenu) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setNotionTabMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notionTabMenu]);

  const clearTabLongPressTimer = () => {
    const t = tabDragRef.current.timer;
    if (t) clearTimeout(t);
    tabDragRef.current.timer = null;
  };

  const openNotionTabMenuBelowEl = (tabId: string, anchor: HTMLElement) => {
    setShowColumnMenu(false);
    setShowVisibilityMenu(false);
    setShowExportMenu(false);
    setOpenFilterMenu(null);
    const r = anchor.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 4;
    left = Math.max(8, Math.min(left, window.innerWidth - 216));
    top = Math.max(8, Math.min(top, window.innerHeight - 260));
    setNotionTabMenu({ tabId, left, top });
  };

  const commitMoveNotionTab = async (tabId: string, delta: number) => {
    const tabs = notionTabsRef.current;
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const isPinned = tabs[idx].pinned === true;
    const pCount = tabs.filter((t) => t.pinned === true).length;
    const groupStart = isPinned ? 0 : pCount;
    const groupEndExclusive = isPinned ? pCount : tabs.length;
    const j = idx + delta;
    if (j < groupStart || j >= groupEndExclusive) return;
    const ids = tabs.map((t) => t.id);
    const [item] = ids.splice(idx, 1);
    ids.splice(j, 0, item);
    try {
      await reorderTabs(ids);
    } catch (err) {
      console.error("Error moviendo pestaña:", err);
    }
    setNotionTabMenu(null);
  };

  const handleDuplicateNotionTabFromMenu = async (tabId: string) => {
    try {
      await duplicateTab(tabId);
      setNotionTabMenu(null);
      setSelectedRows([]);
      setActiveFilters([]);
      clearAllViewFilters();
    } catch (err) {
      console.error("Error duplicando pestaña:", err);
    }
  };

  const handleSetNotionTabPinned = async (tabId: string, pinned: boolean) => {
    try {
      await setTabPinned(tabId, pinned);
      setNotionTabMenu(null);
    } catch (err) {
      console.error("Error al fijar pestaña:", err);
    }
  };

  const onNotionTabPointerDown = (e: React.PointerEvent<HTMLButtonElement>, tabId: string) => {
    if (e.button !== 0) return;
    clearTabLongPressTimer();
    tabDragRef.current.tabId = tabId;
    tabDragRef.current.startX = e.clientX;
    tabDragRef.current.startY = e.clientY;
    tabDragRef.current.pointerId = e.pointerId;
    tabDragRef.current.el = e.currentTarget;
    tabDragRef.current.timer = setTimeout(() => {
      tabDragRef.current.timer = null;
      const tid = tabDragRef.current.tabId;
      if (!tid) return;
      draggingTabIdRef.current = tid;
      const list = notionTabsRef.current;
      const hover = list.findIndex((t) => t.id === tid);
      const h = hover >= 0 ? hover : 0;
      dragHoverIndexRef.current = h;
      setDragHoverIndex(h);
      setDraggingTabId(tid);
      const el = tabDragRef.current.el;
      const pid = tabDragRef.current.pointerId;
      if (el && pid != null) {
        try {
          el.setPointerCapture(pid);
        } catch {
          /* noop */
        }
      }
    }, 480);
  };

  const onNotionTabPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ref = tabDragRef.current;
    if (ref.timer && ref.tabId) {
      const dx = e.clientX - ref.startX;
      const dy = e.clientY - ref.startY;
      if (Math.hypot(dx, dy) > 14) clearTabLongPressTimer();
    }
    if (draggingTabIdRef.current && tabsBarRef.current) {
      const tabs = notionTabsRef.current;
      const dragTab = tabs.find((t) => t.id === draggingTabIdRef.current);
      const isPinned = dragTab?.pinned === true;
      const pCount = tabs.filter((t) => t.pinned === true).length;
      const subsetIds = isPinned ? tabs.slice(0, pCount).map((t) => t.id) : tabs.slice(pCount).map((t) => t.id);
      const localH = computeNotionTabHoverIndex(e.clientX, subsetIds, tabsBarRef.current);
      const globalH = isPinned ? localH : pCount + localH;
      dragHoverIndexRef.current = globalH;
      setDragHoverIndex(globalH);
    }
  };

  const onNotionTabPointerUp: React.PointerEventHandler<HTMLButtonElement> = () => {
    clearTabLongPressTimer();
    const dragId = draggingTabIdRef.current;
    if (dragId) {
      const tabs = notionTabsRef.current;
      const pCount = tabs.filter((t) => t.pinned === true).length;
      const dragTab = tabs.find((t) => t.id === dragId);
      const isPinned = dragTab?.pinned === true;
      const groupIds = isPinned ? tabs.slice(0, pCount).map((t) => t.id) : tabs.slice(pCount).map((t) => t.id);
      const from = groupIds.indexOf(dragId);
      const hoverGlobal = dragHoverIndexRef.current;
      let hoverLocal = isPinned ? hoverGlobal : hoverGlobal - pCount;
      hoverLocal = Math.max(0, Math.min(hoverLocal, groupIds.length));
      if (from >= 0) {
        const nextGroup = [...groupIds];
        const [item] = nextGroup.splice(from, 1);
        let ins = hoverLocal;
        if (from < hoverLocal) ins--;
        ins = Math.max(0, Math.min(ins, nextGroup.length));
        nextGroup.splice(ins, 0, item);
        const fullOrder = isPinned
          ? [...nextGroup, ...tabs.slice(pCount).map((t) => t.id)]
          : [...tabs.slice(0, pCount).map((t) => t.id), ...nextGroup];
        const ids = tabs.map((t) => t.id);
        const changed = fullOrder.some((id, i) => id !== ids[i]);
        if (changed) {
          void reorderTabsRef.current(fullOrder).catch((err) => console.error("Error reordenando pestañas:", err));
          suppressNextTabClickRef.current = true;
        }
      }
      draggingTabIdRef.current = null;
      setDraggingTabId(null);
      setDragHoverIndex(0);
      try {
        const el = tabDragRef.current.el;
        const pid = tabDragRef.current.pointerId;
        if (el && pid != null) el.releasePointerCapture(pid);
      } catch {
        /* noop */
      }
      tabDragRef.current.el = null;
      tabDragRef.current.pointerId = null;
      tabDragRef.current.tabId = null;
      return;
    }
    tabDragRef.current.tabId = null;
    tabDragRef.current.el = null;
    tabDragRef.current.pointerId = null;
  };

  // Limpiar estado local al cambiar de pestaña (evita mezclar datos entre tabs)
  useEffect(() => {
    setRows([]);
    loadedTasksTabRef.current = undefined;
    setBaseColumns([]);
    setCustomColumns([]);
    setSelectedRows([]);
    setActiveFilters([]);
    for (const timer of attachmentSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    attachmentSaveTimersRef.current.clear();
    attachmentSavePayloadRef.current.clear();
    for (const timer of fieldSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    fieldSaveTimersRef.current.clear();
    fieldSavePayloadRef.current.clear();
  }, [activeTabId]);

  // Sincronizar columnas desde la API (solo del tab activo ya cargado)
  useEffect(() => {
    if (columnsLoading || !activeTabId || columnsLoadedForTabId !== activeTabId) return;
    setBaseColumns(initialBaseColumns.map(col => ({ ...col, icon: getIconForType(col.type) })));
    setCustomColumns(initialCustomColumns.map(col => ({ ...col, icon: getIconForType(col.type) })));
  }, [initialBaseColumns, initialCustomColumns, columnsLoading, columnsLoadedForTabId, activeTabId]);

  useEffect(() => {
    if (tasksLoading || !activeTabId || tasksLoadedForTabId !== activeTabId) return;
    setRows((prev) => {
      const sameTab = loadedTasksTabRef.current === activeTabId;
      loadedTasksTabRef.current = activeTabId;
      if (!sameTab || forceTasksReplaceRef.current) {
        forceTasksReplaceRef.current = false;
        return mergeNotionTasks([], tasks) as Task[];
      }
      if (prev.length === 0 && tasks.length > 0) {
        return mergeNotionTasks([], tasks) as Task[];
      }
      return syncNotionTasksFromServer(prev, tasks) as Task[];
    });
  }, [tasks, tasksLoading, activeTabId]);

  const markTableChanged = useCallback(() => {
    lastTableChangeRef.current = Date.now();
    stableCheckpointSentRef.current = false;
  }, []);

  useEffect(() => {
    if (!activeTabId || !auth.user?.id) return;
    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastTableChangeRef.current;
      if (idleMs < 10 * 60 * 1000 || stableCheckpointSentRef.current) return;
      stableCheckpointSentRef.current = true;
      void createStableCheckpoint(activeTabId).catch((err) => console.error("Error en checkpoint estable:", err));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [activeTabId, auth.user?.id, createStableCheckpoint]);

  const flushAttachmentSave = useCallback(async (taskId: string, fieldKey: string) => {
    if (!activeTabId) return;
    const saveKey = `${taskId}:${fieldKey}`;
    const existingTimer = attachmentSaveTimersRef.current.get(saveKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      attachmentSaveTimersRef.current.delete(saveKey);
    }
    const payload = attachmentSavePayloadRef.current.get(saveKey);
    if (!payload) return;
    attachmentSavePayloadRef.current.delete(saveKey);
    try {
      const uploaded = await uploadNotionAttachments(activeTabId, normalizeAttachmentList(payload.value));
      const patch = {
        [payload.fieldKey]: uploaded,
        lastEditedBy: payload.editorName,
      } as Partial<Task>;
      for (const legacyKey of payload.legacyKeys) {
        (patch as Record<string, unknown>)[legacyKey] = uploaded;
      }
      patchTaskLocal(payload.taskId, patch);
      setRows((prev) =>
        prev.map((row) => (row.id === payload.taskId ? { ...row, ...patch } : row)),
      );
      await updateTask(payload.taskId, patch);
    } catch (err) {
      console.error("Error guardando adjuntos:", err);
    }
  }, [activeTabId, patchTaskLocal, updateTask]);

  const flushAttachmentSaves = useCallback(async () => {
    if (!activeTabId) return;
    const payloads = [...attachmentSavePayloadRef.current.values()];
    attachmentSavePayloadRef.current.clear();
    for (const timer of attachmentSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    attachmentSaveTimersRef.current.clear();
    for (const payload of payloads) {
      try {
        const uploaded = await uploadNotionAttachments(activeTabId, normalizeAttachmentList(payload.value));
        const patch = {
          [payload.fieldKey]: uploaded,
          lastEditedBy: payload.editorName,
        } as Partial<Task>;
        for (const legacyKey of payload.legacyKeys) {
          (patch as Record<string, unknown>)[legacyKey] = uploaded;
        }
        patchTaskLocal(payload.taskId, patch);
        setRows((prev) =>
          prev.map((row) => (row.id === payload.taskId ? { ...row, ...patch } : row)),
        );
        await updateTask(payload.taskId, patch);
      } catch (err) {
        console.error("Error guardando adjuntos:", err);
      }
    }
  }, [activeTabId, patchTaskLocal, updateTask]);

  const queueFieldSave = useCallback((taskId: string, patch: Partial<Task>) => {
    const prev = fieldSavePayloadRef.current.get(taskId);
    fieldSavePayloadRef.current.set(taskId, {
      taskId,
      patch: { ...(prev?.patch ?? {}), ...patch },
    });
    const existingTimer = fieldSaveTimersRef.current.get(taskId);
    if (existingTimer) clearTimeout(existingTimer);
    fieldSaveTimersRef.current.set(
      taskId,
      setTimeout(() => {
        fieldSaveTimersRef.current.delete(taskId);
        const payload = fieldSavePayloadRef.current.get(taskId);
        if (!payload) return;
        fieldSavePayloadRef.current.delete(taskId);
        updateTask(payload.taskId, payload.patch).catch((err) =>
          console.error("Error guardando campo:", err),
        );
      }, 280),
    );
  }, [updateTask]);

  const flushFieldSave = useCallback(async (taskId: string) => {
    const existingTimer = fieldSaveTimersRef.current.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      fieldSaveTimersRef.current.delete(taskId);
    }
    const payload = fieldSavePayloadRef.current.get(taskId);
    if (!payload) return;
    fieldSavePayloadRef.current.delete(taskId);
    await updateTask(payload.taskId, payload.patch).catch((err) =>
      console.error("Error guardando campo:", err),
    );
  }, [updateTask]);

  // Calcular la posición del menú de columnas cuando se abre
  useEffect(() => {
    if ((showColumnMenu || showVisibilityMenu) && addColumnButtonRef.current) {
      const rect = addColumnButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [showColumnMenu, showVisibilityMenu]);

  // Cerrar el menú cuando se haga clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (hasOpenFloatingMenu && !target?.toString().includes('notion-menu-root')) {
        const isClickInsideMenu = (target as Element)?.closest('[data-notion-menu-root]');
        if (!isClickInsideMenu) {
          setShowColumnMenu(false);
          setShowVisibilityMenu(false);
          setShowExportMenu(false);
          setOpenFilterMenu(null);
        }
      }
    };

    if (hasOpenFloatingMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  });

  // Cargar usuarios del sistema para auto-fill de Relación al seleccionar Personas
  useEffect(() => {
    fetch(resolveUsersApi(), { cache: "no-store" })
      .then(r => r.ok ? r.json() : [])
      .then(data => setSystemUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const systemPersonaNames = useMemo(
    () => [...new Set(
      systemUsers
        .map((u) => (u.displayName?.trim() || u.username?.trim() || ""))
        .filter(Boolean),
    )],
    [systemUsers],
  );

  const systemAreaNames = useMemo(
    () => [...new Set(
      systemUsers.flatMap((u) => (Array.isArray(u.areas) ? u.areas.map((a) => String(a).trim()).filter(Boolean) : [])),
    )].sort((a, b) => a.localeCompare(b, "es")),
    [systemUsers],
  );

  // Cargar shares del tab activo (modal / detalle)
  useEffect(() => {
    if (!activeTabId || !auth.user?.id) return;
    void syncSharesForTab(activeTabId);
  }, [activeTabId, auth.user?.id, syncSharesForTab]);

  useEffect(() => {
    void refreshOutboundSharesByTab();
  }, [refreshOutboundSharesByTab]);

  useEffect(() => {
    const handler = () => { void refreshOutboundSharesByTab(); };
    window.addEventListener("notion-tabs-updated", handler);
    return () => window.removeEventListener("notion-tabs-updated", handler);
  }, [refreshOutboundSharesByTab]);

  const [cellError, setCellError] = useState<{ row: number; col: string; msg: string } | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});

  const validateByType = (fieldType: string, val: string): string | null => {
    if (!val.trim()) return null;
    switch (fieldType) {
      case "URL":
        return /^https?:\/\/.+\..+/.test(val) ? null : "URL inválida (ej: https://ejemplo.com)";
      case "Correo electrónico":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? null : "Email inválido";
      case "Teléfono":
        return /^\+\d{1,4}\s[\d\s]{6,}$/.test(val) ? null : "Teléfono inválido";
      case "Fecha":
      case "Fecha de creación":
        return /\d/.test(val) ? null : "Ingrese una fecha válida";
      case "ID":
        return /^[a-zA-Z0-9_-]+$/.test(val) ? null : "Solo alfanuméricos, guiones y guiones bajos";
      case "Casilla":
        return /^(sí|si|no|true|false|1|0|✓|✗)$/i.test(val) ? null : "Sí / No";
      default:
        return null;
    }
  };

  const updateTaskField = (rowIdx: number, field: FieldMeta, value: unknown) => {
    markTableChanged();
    const now = new Date().toISOString();
    const editorName = auth.user?.displayName ?? auth.user?.username ?? "";
    setRows((prev) => {
      const taskId = prev[rowIdx]?.id;
      const patch = { [field.key]: value, updatedAt: now, lastEditedBy: editorName } as Partial<Task>;
      for (const legacyKey of field.legacyKeys ?? []) {
        (patch as Record<string, unknown>)[legacyKey] = value;
      }
      if (taskId) {
        patchTaskLocal(taskId, patch);
        if (field.type === "Archivos y multimedia") {
          const saveKey = `${taskId}:${field.key}`;
          attachmentSavePayloadRef.current.set(saveKey, {
            taskId,
            fieldKey: field.key,
            legacyKeys: field.legacyKeys ?? [],
            value,
            editorName,
          });
          const existingTimer = attachmentSaveTimersRef.current.get(saveKey);
          if (existingTimer) clearTimeout(existingTimer);
          attachmentSaveTimersRef.current.set(
            saveKey,
            setTimeout(() => {
              attachmentSaveTimersRef.current.delete(saveKey);
              void flushAttachmentSave(taskId, field.key);
            }, 700),
          );
        } else {
          queueFieldSave(taskId, { [field.key]: value, lastEditedBy: editorName } as Partial<Task>);
        }
      }
      return prev.map((row, idx) => (idx === rowIdx ? { ...row, ...patch } : row));
    });
  };

  // Guardar áreas de un usuario desde el panel de gestión
  const saveUserAreas = async (userId: string, areas: string[]) => {
    setAreasLoading(true);
    const cleaned = sanitizeDepartmentAreas(areas);
    try {
      await fetch(resolveUsersApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "update", id: userId, areas: cleaned }),
      });
      setSystemUsers(prev => prev.map(u => u.id === userId ? { ...u, areas: cleaned } : u));
    } catch {}
    setAreasLoading(false);
  };

  // Auto-fill de Relación (área) al seleccionar una persona en columna Personas
  const handlePersonasChange = (rowIdx: number, prevValue: unknown, newValue: unknown) => {
    const prevPeople = parseMultiSelectValue(prevValue);
    const newPeople = parseMultiSelectValue(newValue);
    const addedPeople = newPeople.filter(p => !prevPeople.includes(p));
    if (addedPeople.length === 0) return;

    const relacionField = allFieldMetas.find(f => f.type === "Relación");
    if (!relacionField) return;

    // Tomar la última persona añadida
    const addedPerson = addedPeople[addedPeople.length - 1];
    const sysUser = systemUsers.find(u =>
      u.displayName === addedPerson || u.username === addedPerson
    );
    if (!sysUser || !sysUser.areas || sysUser.areas.length === 0) return;

    if (sysUser.areas.length === 1) {
      updateTaskField(rowIdx, relacionField, sysUser.areas[0]);
    } else {
      setAreaPicker({ rowIdx, relacionField, personName: addedPerson, options: sysUser.areas });
    }
  };

  const updateColumnOptionsList = (kind: "base" | "custom", index: number, options: string[]) => {
    if (kind === "base") {
      const updatedBase = baseColumns.map((column, idx) => (idx === index ? { ...column, options } : column));
      setBaseColumns(updatedBase);
      saveColumns(updatedBase, customColumns).catch((err) => console.error("Error guardando columna:", err));
      return;
    }
    const updatedCustom = customColumns.map((column, idx) => (idx === index ? { ...column, options } : column));
    setCustomColumns(updatedCustom);
    saveColumns(baseColumns, updatedCustom).catch((err) => console.error("Error guardando columna:", err));
  };

  const addColumnOption = (kind: "base" | "custom", index: number, column: Column, rawValue?: string) => {
    const draftKey = column.id || `${kind}_${index}`;
    const value = (rawValue ?? optionDrafts[draftKey] ?? "").trim();
    if (!value) return;
    
    const currentColumn = kind === "base" ? baseColumns[index] : customColumns[index];
    const currentOptions = currentColumn?.options || [];
    const nextOptions = Array.from(new Set([...currentOptions, value]));
    const autoColor = paletteColorFor(value);

    if (kind === "base") {
      const updatedBase = baseColumns.map((col, idx) =>
        idx === index
          ? { ...col, options: nextOptions, optionColors: { ...col.optionColors, [value]: autoColor } }
          : col
      );
      setBaseColumns(updatedBase);
      saveColumns(updatedBase, customColumns).catch((err) => console.error("Error guardando columna:", err));
    } else {
      const updatedCustom = customColumns.map((col, idx) =>
        idx === index
          ? { ...col, options: nextOptions, optionColors: { ...col.optionColors, [value]: autoColor } }
          : col
      );
      setCustomColumns(updatedCustom);
      saveColumns(baseColumns, updatedCustom).catch((err) => console.error("Error guardando columna:", err));
    }

    setOptionDrafts((prev) => ({ ...prev, [draftKey]: "" }));
  };

  const removeColumnOption = (kind: "base" | "custom", index: number, column: Column, option: string) => {
    // Get fresh column from state to ensure we have latest options
    const currentColumn = kind === "base" ? baseColumns[index] : customColumns[index];
    const currentOptions = currentColumn?.options || [];
    
    const nextOptions = currentOptions.filter((item) => item !== option);
    updateColumnOptionsList(kind, index, nextOptions);
  };

  const colorSaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const updateOptionColor = (kind: "base" | "custom", index: number, option: string, color: string) => {
    const presetColor = normalizeToPresetColor(color, option);
    // Update state immediately for smooth UI
    if (kind === "base") {
      const updatedBase = baseColumns.map((col, idx) => 
        idx === index 
          ? { ...col, optionColors: { ...col.optionColors, [option]: presetColor } }
          : col
      );
      setBaseColumns(updatedBase);
      
      // Debounce save to database
      if (colorSaveTimeoutRef.current) {
        clearTimeout(colorSaveTimeoutRef.current);
      }
      colorSaveTimeoutRef.current = setTimeout(() => {
        saveColumns(updatedBase, customColumns).catch(err => console.error("Error guardando color:", err));
      }, 500);
    } else {
      const updatedCustom = customColumns.map((col, idx) => 
        idx === index 
          ? { ...col, optionColors: { ...col.optionColors, [option]: presetColor } }
          : col
      );
      setCustomColumns(updatedCustom);
      
      // Debounce save to database
      if (colorSaveTimeoutRef.current) {
        clearTimeout(colorSaveTimeoutRef.current);
      }
      colorSaveTimeoutRef.current = setTimeout(() => {
        saveColumns(baseColumns, updatedCustom).catch(err => console.error("Error guardando color:", err));
      }, 500);
    }
  };

  const toggleColumnOptionHidden = (kind: "base" | "custom", index: number, option: string) => {
    const list = kind === "base" ? baseColumns : customColumns;
    const currentColumn = list[index];
    if (!currentColumn) return;
    const currentHidden = currentColumn.hiddenOptions || [];
    const nextHidden = currentHidden.includes(option)
      ? currentHidden.filter((item) => item !== option)
      : [...currentHidden, option];

    if (kind === "base") {
      const updatedBase = baseColumns.map((col, idx) =>
        idx === index ? { ...col, hiddenOptions: nextHidden } : col
      );
      setBaseColumns(updatedBase);
      saveColumns(updatedBase, customColumns).catch(err => console.error("Error guardando visibilidad:", err));
    } else {
      const updatedCustom = customColumns.map((col, idx) =>
        idx === index ? { ...col, hiddenOptions: nextHidden } : col
      );
      setCustomColumns(updatedCustom);
      saveColumns(baseColumns, updatedCustom).catch(err => console.error("Error guardando visibilidad:", err));
    }
  };

  const renderFieldValue = (field: FieldMeta, value: unknown, rowIdx?: number) => {
    if (field.type === "Fecha") {
      return <span>{formatDateForDisplay(value)}</span>;
    }
    if (field.type === "Fecha de creación" || field.type === "Última edición") {
      if (!value || typeof value !== "string") return <span style={{ color: "var(--text-dim)" }}>—</span>;
      try {
        const date = new Date(value);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>{`${day}/${month}/${year} ${hours}:${minutes}`}</span>;
      } catch {
        return <span style={{ color: "var(--text-dim)" }}>—</span>;
      }
    }
    if (field.type === "Creado por" || field.type === "Última edición por") {
      if (!value || typeof value !== "string") return <span style={{ color: "var(--text-dim)", opacity: 0.5 }}>—</span>;
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg)", borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
          <FiUser size={10} /> {value}
        </span>
      );
    }
    if (field.type === "Casilla") {
      const checked = isCheckboxChecked(value);
      return <span className={notionStyles.checkboxValueActive}>{checked ? "✓" : ""}</span>;
    }
    if (field.type === "Seleccionar" || field.type === "Relación" || field.type === "Estado") {
      const selected = typeof value === "string" ? value : "";
      const column = field.kind === "base" ? baseColumns[field.index] : customColumns[field.index];
      const chipColor = selected ? resolveOptionHexColor(selected, column) : null;

      return selected ? (
        <span
          className={notionStyles.selectChip}
          style={optionChipStyle(chipColor!)}
        >
          {selected}
          {rowIdx !== undefined ? (
            <button
              type="button"
              className={notionStyles.selectChipRemove}
              onClick={(event) => {
                event.stopPropagation();
                updateTaskField(rowIdx, field, "");
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      ) : <span className={notionStyles.placeholderValue}>—</span>;
    }
    if (field.type === "Selección múltiple" || field.type === "Personas") {
      const selected = parseMultiSelectValue(value);
      if (!selected.length) return <span className={notionStyles.placeholderValue}>—</span>;
      const column = field.kind === "base" ? baseColumns[field.index] : customColumns[field.index];
      return (
        <div className={notionStyles.multiChipList}>
          {selected.map((item) => {
            const chipColor = resolveOptionHexColor(item, column);
            return (
              <span
                key={item}
                className={notionStyles.selectChip}
                style={optionChipStyle(chipColor)}
              >
                {item}
                {rowIdx !== undefined ? (
                  <button
                    type="button"
                    className={notionStyles.selectChipRemove}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateTaskField(rowIdx, field, selected.filter((value) => value !== item).join(", "));
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      );
    }
    if (field.type === "Archivos y multimedia") {
      const attachments = normalizeAttachmentList(value);
      if (!attachments.length) return <span className={notionStyles.placeholderValue}>—</span>;
      return <AttachmentSummary attachments={attachments} maxVisible={3} />;
    }
    return typeof value === "string" && value.trim() ? value : <span className={notionStyles.placeholderValue}>—</span>;
  };

  const renderFieldEditor = (rowIdx: number, row: Task, field: FieldMeta, colIdx: number, className?: string, displayRowIdx?: number) => {
    const rawValue = readTaskField(row, field);
    const isEditing = editingCell?.row === rowIdx && editingCell?.key === field.key;
    const hasCellError = cellError?.row === rowIdx && cellError?.col === field.key;
    const cellProps = {
      className: getCellClassName(rowIdx, colIdx, className),
      onMouseEnter: () => setHoveredCell({ row: rowIdx, col: colIdx }),
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        selectRowForDeletion(row);
      },
    };

    if (field.type === "Casilla") {
      const checked = isCheckboxChecked(rawValue);
      return (
        <td {...cellProps} style={{ cursor: "pointer" }} onClick={() => updateTaskField(rowIdx, field, checked ? "" : "✓")}>
          <span className={checked ? notionStyles.checkboxValueActive : notionStyles.checkboxValue}>{checked ? "✓" : ""}</span>
        </td>
      );
    }

    if (field.type === "ID") {
      return (
        <td {...cellProps} style={{ cursor: "default", color: "var(--text-dim)", fontWeight: 600 }}>
          {(displayRowIdx ?? rowIdx) + 1}
        </td>
      );
    }

    if (field.type === "Correo electrónico" && !isEditing) {
      const email = typeof rawValue === "string" ? rawValue.trim() : "";
      return (
        <td
          {...cellProps}
          onClick={(event) => {
            if (event.ctrlKey && isValidEmail(email)) {
              event.preventDefault();
              event.stopPropagation();
              window.location.href = `mailto:${email}`;
              return;
            }
            setEditingCell({ row: rowIdx, key: field.key });
            setSelectedRows([]);
          }}
          style={{ cursor: isValidEmail(email) ? "pointer" : "text" }}
        >
          {isValidEmail(email) ? (
            <span className={notionStyles.emailLink} title="Ctrl + click para escribir correo">
              {email}
            </span>
          ) : tabsLoading ? (
          <main className={styles.content}>
            <div className={styles.loading}>Cargando pestañas...</div>
          </main>
        ) : (
            <span className={notionStyles.placeholderValue}>—</span>
          )}
        </td>
      );
    }

    if (field.type === "URL" && !isEditing) {
      const url = typeof rawValue === "string" ? rawValue.trim() : "";
      return (
        <td
          {...cellProps}
          onClick={(event) => {
            if (event.ctrlKey && isValidUrl(url)) {
              event.preventDefault();
              event.stopPropagation();
              window.open(url, "_blank", "noopener,noreferrer");
              return;
            }
            setEditingCell({ row: rowIdx, key: field.key });
            setSelectedRows([]);
          }}
          style={{ cursor: isValidUrl(url) ? "pointer" : "text" }}
        >
          {isValidUrl(url) ? (
            <span className={notionStyles.emailLink} title="Ctrl + click para abrir enlace">
              {url}
            </span>
          ) : (
            <span className={notionStyles.placeholderValue}>—</span>
          )}
        </td>
      );
    }

    if (!isEditing) {
      // Read-only fields should not be editable
      const isReadOnly = field.type === "Fecha de creación" || field.type === "Última edición" || field.type === "Creado por" || field.type === "Última edición por";
      return (
        <td {...cellProps} onClick={isReadOnly ? undefined : () => {
          setEditingCell({ row: rowIdx, key: field.key });
          setSelectedRows([]);
        }} style={{ cursor: isReadOnly ? "default" : "text" }}>
          {field.type === "Lugar" ? <span className={notionStyles.notionLocationTag}>{getLocationDisplayLabel(rawValue)}</span> : renderFieldValue(field, rawValue, rowIdx)}
        </td>
      );
    }

    if (field.type === "Fecha") {
      return (
        <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
          <DateInput
            value={toDateInputValue(rawValue)}
            onChange={(v) => updateTaskField(rowIdx, field, v)}
            onClose={() => setEditingCell(null)}
          />
        </td>
      );
    }

    if (field.type === "Seleccionar" || field.type === "Selección múltiple" || field.type === "Personas" || field.type === "Relación" || field.type === "Estado") {
      // Para Relación: mostrar las áreas de las personas seleccionadas en la misma fila
      const getRelationOptionsForRow = () => {
        const personasField = allFieldMetas.find(f => f.type === "Personas");
        if (personasField && systemUsers.length > 0) {
          const personasValue = readTaskField(row, personasField);
          const selectedPeople = parseMultiSelectValue(personasValue);
          if (selectedPeople.length > 0) {
            const areas = selectedPeople.flatMap(name => {
              const sysUser = systemUsers.find(u => u.displayName === name || u.username === name);
              return sysUser?.areas || [];
            });
            const uniqueAreas = [...new Set(areas)];
            if (uniqueAreas.length > 0) return uniqueAreas;
          }
        }
        // Fallback: opciones guardadas en la columna
        return getRelationOptions(field);
      };

      const baseEffectiveOptions = field.type === "Estado" && !(field.options || []).length
        ? defaultStatusOptions
        : field.type === "Relación"
          ? getRelationOptionsForRow()
          : field.type === "Personas"
            ? mergePersonasVariables(systemPersonaNames, field.options || [])
            : field.options || [];
      // Ocultar del selector las opciones marcadas como no visibles, pero conservar
      // las que ya estén seleccionadas en la fila para no perder datos existentes.
      const optionColumn = field.kind === "base" ? baseColumns[field.index] : customColumns[field.index];
      const hiddenOpts = optionColumn?.hiddenOptions || [];
      const currentlySelected = parseMultiSelectValue(rawValue);
      const effectiveOptions = hiddenOpts.length
        ? baseEffectiveOptions.filter((opt) => !hiddenOpts.includes(opt) || currentlySelected.includes(opt))
        : baseEffectiveOptions;
      return (
        <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
          <SelectInput
            type={field.type === "Selección múltiple" || field.type === "Personas" ? "Selección múltiple" : "Seleccionar"}
            options={effectiveOptions}
            value={rawValue}
            onChange={(v) => {
              const prev = rawValue;
              updateTaskField(rowIdx, field, v);
              if (field.type === "Personas") {
                handlePersonasChange(rowIdx, prev, v);
              }
            }}
            onClose={() => setEditingCell(null)}
            onAddOption={(option) => {
              const column = field.kind === "base" ? baseColumns[field.index] : customColumns[field.index];
              if (column) {
                addColumnOption(field.kind, field.index, column, option);
              }
            }}
          />
        </td>
      );
    }

    if (field.type === "Archivos y multimedia") {
      const attachments = normalizeAttachmentList(rawValue);
      return (
        <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
          <FileInput
            value={attachments}
            onChange={(v) => updateTaskField(rowIdx, field, v)}
            onClose={() => {
              void (async () => {
                if (row.id) await flushAttachmentSave(row.id, field.key);
                setEditingCell(null);
              })();
            }}
          />
        </td>
      );
    }

    if (field.type === "Lugar") {
      return (
        <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
          <LocationInput
            value={rawValue}
            onChange={(value) => {
              updateTaskField(rowIdx, field, value);
              setCellError(null);
            }}
            onClose={() => setEditingCell(null)}
            placeholder="Buscar ubicación o apodo..."
            aliases={field.options}
          />
        </td>
      );
    }

    if (field.type === "Fecha de creación" || field.type === "Última edición") {
      const timestamp = rawValue;
      let formattedDate = "—";
      if (timestamp && typeof timestamp === "string") {
        try {
          const date = new Date(timestamp);
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          formattedDate = `${day}/${month}/${year} ${hours}:${minutes}`;
        } catch {
          formattedDate = "—";
        }
      }
      return (
        <td {...cellProps} style={{ cursor: "default", color: "var(--text-dim)", fontSize: "11px" }}>
          {formattedDate}
        </td>
      );
    }

    if (field.type === "Teléfono") {
      return (
        <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
          <PhoneInput
            value={rawValue}
            onChange={(v) => updateTaskField(rowIdx, field, v)}
            onClose={() => setEditingCell(null)}
          />
        </td>
      );
    }

    return (
      <td {...cellProps} style={{ overflow: "visible", position: "relative" }}>
        <div style={{ position: "relative" }}>
          <input
            className={`${notionStyles.cellInput} ${hasCellError ? notionStyles.cellInputError : ""}`}
            value={typeof rawValue === "string" ? rawValue : ""}
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              updateTaskField(rowIdx, field, v);
              const err = validateByType(field.type, v);
              setCellError(err ? { row: rowIdx, col: field.key, msg: err } : null);
            }}
            onBlur={async () => {
              if (row.id) await flushFieldSave(row.id);
              setEditingCell(null);
              setCellError(null);
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                if (row.id) await flushFieldSave(row.id);
                setEditingCell(null);
                setCellError(null);
              }
            }}
          />
          {hasCellError ? <div className={notionStyles.cellErrorTooltip}>{cellError?.msg}</div> : null}
        </div>
      </td>
    );
  };

  const columnTypes = [
    { label: "Texto", icon: <FiType /> },
    { label: "Seleccionar", icon: <FiCheckCircle /> },
    { label: "Selección múltiple", icon: <FiBook /> },
    { label: "Estado", icon: <FiLayers /> },
    { label: "Fecha", icon: <FiCalendar /> },
    { label: "Personas", icon: <FiUsers /> },
    { label: "Archivos y multimedia", icon: <FiPaperclip /> },
    { label: "Casilla", icon: <FiCheckCircle /> },
    { label: "URL", icon: <FiLink /> },
    { label: "Teléfono", icon: <FiPhone /> },
    { label: "Correo electrónico", icon: <FiMail /> },
    { label: "Relación", icon: <FiArrowUpRight /> },
    { label: "ID", icon: <FiHash /> },
    { label: "Lugar", icon: <FiMapPin /> },
    { label: "Fecha de creación", icon: <FiClock /> },
    { label: "Última edición", icon: <FiClock /> },
    { label: "Creado por", icon: <FiUser /> },
    { label: "Última edición por", icon: <FiUser /> },
  ];

  const handleAddColumn = (type: { label: string; icon: ReactNode }) => {
    // Check for duplicate names and add (1), (2), etc. (only check visible columns)
    const allVisibleColumns = [...baseColumns, ...customColumns].filter(col => !col.hidden);
    let finalTitle = type.label;
    let counter = 1;
    
    while (allVisibleColumns.some(col => col.title === finalTitle)) {
      finalTitle = `${type.label} (${counter})`;
      counter++;
    }
    
    const newColumn = {
      id: `custom_${slugify(type.label)}_${customColumns.length + 1}`,
      title: finalTitle,
      savedTitle: finalTitle,
      type: type.label,
      icon: type.icon,
      hidden: false,
      pinned: false,
      fit: false,
      filter: false,
      sort: "",
      group: false,
      calculate: "",
      options: type.label === "Estado" ? [...defaultStatusOptions] : [] as string[],
      optionColors: type.label === "Estado" ? { ...defaultStatusColors } : {},
    };
    const updatedCustomColumns = [...customColumns, newColumn];
    setCustomColumns(updatedCustomColumns);
    saveColumns(baseColumns, updatedCustomColumns).catch(err => console.error("Error guardando columna:", err));
    setShowColumnMenu(false);
  };

  const updateColumnTitle = (kind: "base" | "custom", index: number, title: string) => {
    // Validar que no haya nombres duplicados (solo comparar títulos visibles, no tipos ni columnas ocultas)
    const allColumns = kind === "base" ? baseColumns : customColumns;
    const otherColumns = kind === "base" ? customColumns : baseColumns;
    
    // Normalizar para comparación case-insensitive
    const normalizedTitle = title.trim().toLowerCase();
    
    // Solo comparar con columnas visibles
    const isDuplicate = allColumns.some((col, idx) => idx !== index && !col.hidden && col.title.trim().toLowerCase() === normalizedTitle) || 
                        otherColumns.some(col => !col.hidden && col.title.trim().toLowerCase() === normalizedTitle);
    
    if (isDuplicate && title.trim() !== "") {
      // Mostrar error pero no actualizar
      setDuplicateError(true);
      setTimeout(() => setDuplicateError(false), 3000);
      return;
    }
    
    setDuplicateError(false);
    
    if (kind === "base") {
      const updatedBase = baseColumns.map((column, idx) => (idx === index ? { ...column, title } : column));
      setBaseColumns(updatedBase);
      saveColumns(updatedBase, customColumns).catch(err => console.error("Error guardando columna:", err));
      return;
    }
    const updatedCustom = customColumns.map((column, idx) => (idx === index ? { ...column, title } : column));
    setCustomColumns(updatedCustom);
    saveColumns(baseColumns, updatedCustom).catch(err => console.error("Error guardando columna:", err));
  };

  const deleteCustomColumn = (index: number) => {
    const updatedCustom = customColumns.filter((_, idx) => idx !== index);
    setCustomColumns(updatedCustom);
    saveColumns(baseColumns, updatedCustom).catch(err => console.error("Error guardando columna:", err));
    setActiveColumnMenu(null);
  };

  const updateColumnOption = (
    kind: "base" | "custom",
    index: number,
    changes: Partial<{ hidden: boolean; pinned: boolean; fit: boolean; filter: boolean; sort: string; group: boolean; calculate: string; options: string[]; width: number; relationSource: string; previousIndex: number }>
  ) => {
    if (changes.sort) {
      const hasOtherSort =
        baseColumns.some((column, idx) => column.sort && !(kind === "base" && idx === index)) ||
        customColumns.some((column, idx) => column.sort && !(kind === "custom" && idx === index));
      if (hasOtherSort) return;
    }

    if (kind === "base") {
      const updatedBase = baseColumns.map((column, idx) => (idx === index ? { ...column, ...changes } : changes.sort ? { ...column, sort: "" } : column));
      const updatedCustom = changes.sort ? customColumns.map((column) => ({ ...column, sort: "" })) : customColumns;
      setBaseColumns(updatedBase);
      if (changes.sort) setCustomColumns(updatedCustom);
      saveColumns(updatedBase, updatedCustom).catch(err => console.error("Error guardando columna:", err));
      return;
    }
    const updatedBase = changes.sort ? baseColumns.map((column) => ({ ...column, sort: "" })) : baseColumns;
    const updatedCustom = customColumns.map((column, idx) => (idx === index ? { ...column, ...changes } : changes.sort ? { ...column, sort: "" } : column));
    if (changes.sort) setBaseColumns(updatedBase);
    setCustomColumns(updatedCustom);
    saveColumns(updatedBase, updatedCustom).catch(err => console.error("Error guardando columna:", err));
  };

  const startColumnResize = (
    event: React.MouseEvent,
    kind: "base" | "custom",
    index: number,
    currentWidth?: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = currentWidth || 160;
    let latestWidth = startWidth;

    // Get column type to determine minimum width
    const column = kind === "base" ? baseColumns[index] : customColumns[index];
    const minWidth = column?.type === "Casilla" ? 30 : 50;

    document.body.classList.add(notionStyles.resizingColumns);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Resize from right: dragging right increases width, dragging left decreases width
      latestWidth = Math.max(minWidth, Math.min(520, startWidth + (moveEvent.clientX - startX)));
      if (kind === "base") {
        setBaseColumns((prev) => prev.map((column, idx) => (idx === index ? { ...column, width: latestWidth } : column)));
      } else {
        setCustomColumns((prev) => prev.map((column, idx) => (idx === index ? { ...column, width: latestWidth } : column)));
      }
    };

    const handleMouseUp = () => {
      document.body.classList.remove(notionStyles.resizingColumns);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (kind === "base") {
        const nextBase = baseColumns.map((column, idx) => (idx === index ? { ...column, width: latestWidth } : column));
        setBaseColumns(nextBase);
        saveColumns(nextBase, customColumns).catch(err => console.error("Error guardando columna:", err));
        return;
      }
      const nextCustom = customColumns.map((column, idx) => (idx === index ? { ...column, width: latestWidth } : column));
      setCustomColumns(nextCustom);
      saveColumns(baseColumns, nextCustom).catch(err => console.error("Error guardando columna:", err));
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };


  const duplicateCustomColumn = (index: number) => {
    const column = customColumns[index];
    if (!column) return;
    const duplicated = [
      ...customColumns.slice(0, index + 1),
      {
        ...column,
        id: `${column.id || `custom_${slugify(column.type || column.title || "column")}_${index + 1}`}_copy`,
        title: `${column.title} copia`,
        savedTitle: `${column.title} copia`,
        options: Array.isArray(column.options) ? [...column.options] : [],
      },
      ...customColumns.slice(index + 1),
    ];
    setCustomColumns(duplicated);
    saveColumns(baseColumns, duplicated).catch(err => console.error("Error guardando columna:", err));
    setActiveColumnMenu(null);
  };

  const moveColumnOneStep = (kind: "base" | "custom", index: number, direction: "left" | "right") => {
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    const source = kind === "base" ? baseColumns : customColumns;
    if (targetIndex < 0 || targetIndex >= source.length) return;
    const next = [...source];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    if (kind === "base") {
      setBaseColumns(next);
      saveColumns(next, customColumns).catch(err => console.error("Error guardando columna:", err));
    } else {
      setCustomColumns(next);
      saveColumns(baseColumns, next).catch(err => console.error("Error guardando columna:", err));
    }
    setActiveColumnMenu(null);
  };

  const handleColumnDragOver = (event: React.DragEvent, kind: "base" | "custom", index: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!draggedColumn) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setColumnDropTarget({ kind, index, side });
  };

  const handleColumnDrop = (targetKind: "base" | "custom", targetIndex: number, side: "before" | "after" = "before") => {
    const destinationIndex = side === "after" ? targetIndex + 1 : targetIndex;
    if (!draggedColumn || (draggedColumn.kind === targetKind && draggedColumn.index === targetIndex && side === "before")) {
      setDraggedColumn(null);
      setColumnDropTarget(null);
      return;
    }

    const nextBase = [...baseColumns];
    const nextCustom = [...customColumns];
    const source = draggedColumn.kind === "base" ? nextBase : nextCustom;
    const target = targetKind === "base" ? nextBase : nextCustom;
    const [sourceColumn] = source.splice(draggedColumn.index, 1);

    if (!sourceColumn) {
      setDraggedColumn(null);
      return;
    }

    const moved = {
      ...sourceColumn,
      fieldKey: getColumnFieldKey(sourceColumn, draggedColumn.index, draggedColumn.kind),
    };

    const insertIndex =
      draggedColumn.kind === targetKind && draggedColumn.index < destinationIndex
        ? destinationIndex - 1
        : destinationIndex;

    target.splice(Math.max(0, Math.min(insertIndex, target.length)), 0, moved);
    setBaseColumns(nextBase);
    setCustomColumns(nextCustom);
    saveColumns(nextBase, nextCustom).catch(err => console.error("Error guardando orden de columnas:", err));
    setDraggedColumn(null);
    setColumnDropTarget(null);
  };

  const openColumnPropertyMenu = (
    event: React.MouseEvent,
    kind: "base" | "custom",
    index: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedColumn) return;
    setPropertyMenuPosition({ top: Math.max(12, Math.min(event.clientY + 4, window.innerHeight - 490)), left: Math.max(12, Math.min(event.clientX + 4, window.innerWidth - 340)) });
    setActiveColumnMenu({ kind, index });
    setShowColumnMenu(false);
    setShowVisibilityMenu(false);
  };

  const hasOtherActiveSort = (kind: "base" | "custom", index: number) =>
    baseColumns.some((column, idx) => column.sort && !(kind === "base" && idx === index)) ||
    customColumns.some((column, idx) => column.sort && !(kind === "custom" && idx === index));

  const toggleColumnPinned = (kind: "base" | "custom", index: number) => {
    const list = kind === "base" ? baseColumns : customColumns;
    const column = list[index];
    if (!column) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    if (column.pinned) {
      const restoreIndex = Math.max(0, Math.min(column.previousIndex ?? index, next.length));
      next.splice(restoreIndex, 0, { ...moved, pinned: false, previousIndex: undefined });
    } else {
      next.unshift({ ...moved, pinned: true, previousIndex: index });
    }
    if (kind === "base") {
      setBaseColumns(next);
      saveColumns(next, customColumns).catch(err => console.error("Error guardando columna fijada:", err));
      return;
    }
    setCustomColumns(next);
    saveColumns(baseColumns, next).catch(err => console.error("Error guardando columna fijada:", err));
  };

  const renderPropertyMenu = (kind: "base" | "custom", index: number, column: { title: string; savedTitle: string; type: string; icon: ReactNode; hidden: boolean; pinned: boolean; fit: boolean; filter: boolean; sort: string; group: boolean; calculate: string; options?: string[]; id?: string; relationSource?: string }) =>
    activeColumnMenu?.kind === kind && activeColumnMenu.index === index && typeof document !== "undefined" ? (
      ReactDOM.createPortal(
      <div
        className={notionStyles.propertyMenu}
        data-notion-menu-root
        style={propertyMenuPosition ? { top: propertyMenuPosition.top, left: propertyMenuPosition.left } : undefined}
        onClick={(event) => event.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={notionStyles.propertyTitleRow}>
          <span>{column.icon}</span>
          <input
            value={column.title}
            onChange={(event) => updateColumnTitle(kind, index, event.target.value)}
            placeholder="Título"
            autoFocus
            style={duplicateError ? { borderColor: "#ff5d5d" } : undefined}
          />
          <span
            className={`${notionStyles.propertyInfo} ${
              duplicateError ? notionStyles.propertyInfoError : !column.title.trim() ? notionStyles.propertyInfoWarning : ""
            }`}
            title={duplicateError ? "Nombre duplicado" : !column.title.trim() ? "El nombre es obligatorio" : "Información"}
          >
            i
          </span>
        </div>
        {duplicateError ? (
          <div className={notionStyles.renameNotice} style={{ background: "rgba(255, 93, 93, 0.16)", color: "#ff5d5d" }}>Este nombre ya existe.</div>
        ) : !column.title.trim() ? (
          <div className={notionStyles.renameNotice} style={{ background: "rgba(242, 201, 76, 0.16)", color: "#8b6914" }}>El nombre es obligatorio.</div>
        ) : null}
        <div className={notionStyles.propertyDivider} />
        <button className={column.filter ? notionStyles.activePropertyAction : ""} onClick={() => updateColumnOption(kind, index, { filter: !column.filter })}><FiType /> Filtro {column.filter ? <span>Activo</span> : null}</button>
        <button onClick={() => setOpenSubmenu(openSubmenu === "sort" ? null : "sort")}><FiSliders /> Ordenar <span>{column.sort || "›"}</span></button>
        {openSubmenu === "sort" ? (
          <div className={notionStyles.propertySubmenu}>
            {hasOtherActiveSort(kind, index) ? <div className={notionStyles.renameNotice}>Ya hay otra columna ordenando.</div> : null}
            <button disabled={hasOtherActiveSort(kind, index)} onClick={() => updateColumnOption(kind, index, { sort: "Asc" })}>Ascendente</button>
            <button disabled={hasOtherActiveSort(kind, index)} onClick={() => updateColumnOption(kind, index, { sort: "Desc" })}>Descendente</button>
            <button onClick={() => updateColumnOption(kind, index, { sort: "" })}>Sin ordenar</button>
          </div>
        ) : null}
        <button className={column.group ? notionStyles.activePropertyAction : ""} onClick={() => updateColumnOption(kind, index, { group: !column.group })}><FiLayers /> Grupo {column.group ? <span>Activo</span> : null}</button>
        {column.type === "Relación" && !isAreaRelationColumn(column, kind) ? (
          <>
            <div className={notionStyles.propertyDivider} />
            <div className={notionStyles.propertyOptionsSection}>
              <div className={notionStyles.propertyOptionsTitle}>Relacionar con</div>
              <select
                className={notionStyles.propertySelect}
                value={column.relationSource || ""}
                onChange={(event) => updateColumnOption(kind, index, { relationSource: event.target.value })}
              >
                <option value="">Elegir columna...</option>
                {relationSourceColumns.map((source) => (
                  <option key={source.id || source.savedTitle || source.title} value={source.id || source.savedTitle || source.title}>
                    {source.title}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        {(column.type === "Seleccionar" || column.type === "Selección múltiple" || column.type === "Personas" || column.type === "Relación" || column.type === "Estado" || column.type === "Lugar") ? (
          <>
            <div className={notionStyles.propertyDivider} />
            <div className={notionStyles.propertyOptionsSection}>
              <div className={notionStyles.propertyOptionsTitle}>
                {column.type === "Lugar" ? "Apodos" : column.type === "Relación" && isAreaRelationColumn(column, kind) ? "Áreas" : "Variables"}
              </div>
              <div className={notionStyles.propertyOptionsList}>
                {(() => {
                  const variableOptions = column.type === "Personas"
                    ? mergePersonasVariables(systemPersonaNames, column.options || [])
                    : column.type === "Relación" && isAreaRelationColumn(column, kind)
                      ? mergeAreasVariables(systemAreaNames, column.options || [])
                      : (column.options || []);

                  if (column.type === "Personas" && variableOptions.length === 0) {
                    return (
                      <p className={notionStyles.propertyOptionsEmpty}>
                        {systemUsers.length === 0 ? "Cargando usuarios…" : "Sin usuarios registrados"}
                      </p>
                    );
                  }

                  if (column.type === "Relación" && isAreaRelationColumn(column, kind) && variableOptions.length === 0) {
                    return (
                      <p className={notionStyles.propertyOptionsEmpty}>
                        {systemUsers.length === 0
                          ? "Cargando áreas…"
                          : "Sin áreas aún. Asígnalas en Personas → Áreas o agrégalas abajo."}
                      </p>
                    );
                  }

                  return variableOptions.map((option) => {
                    const currentColumn = kind === "base" ? baseColumns[index] : customColumns[index];
                    const optionColor = resolveOptionHexColor(option, currentColumn);
                    const pickerKey = `${kind}_${index}_${option}`;
                    const isPickerOpen = openColorPicker === pickerKey;
                    
                    const isLockedSystemPersona = column.type === "Personas" && systemPersonaNames.includes(option);
                    const isLockedSystemArea = column.type === "Relación" && isAreaRelationColumn(column, kind) && systemAreaNames.includes(option);
                    const isLockedSystemVariable = isLockedSystemPersona || isLockedSystemArea;
                    const isOptionHidden = (currentColumn?.hiddenOptions || []).includes(option);
                    
                    return (
                      <div key={option} className={notionStyles.propertyOptionItem}>
                        {(column.type === "Estado" || column.type === "Seleccionar" || column.type === "Selección múltiple" || column.type === "Personas" || column.type === "Relación") && (
                          <div className={notionStyles.colorPickerWrap}>
                            <button
                              type="button"
                              className={notionStyles.colorPickerButton}
                              style={{ backgroundColor: optionColor }}
                              onClick={() => setOpenColorPicker(isPickerOpen ? null : pickerKey)}
                              title="Cambiar color"
                            />
                            {isPickerOpen && (
                              <div className={notionStyles.colorPickerDropdown}>
                                {COLOR_PRESETS.map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    className={notionStyles.colorSwatch}
                                    style={{ backgroundColor: color }}
                                    onClick={() => {
                                      updateOptionColor(kind, index, option, color);
                                      setOpenColorPicker(null);
                                    }}
                                    title={color}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <span 
                          style={{ ...optionChipStyle(optionColor), opacity: isOptionHidden ? 0.45 : 1 }}
                          title={isLockedSystemPersona ? "Usuario del sistema" : isLockedSystemArea ? "Área asignada a usuarios" : undefined}
                        >
                          {isLockedSystemPersona ? <FiUser size={12} style={{ opacity: 0.75, flexShrink: 0 }} /> : null}
                          {isLockedSystemArea ? <FiMapPin size={12} style={{ opacity: 0.75, flexShrink: 0 }} /> : null}
                          {option}
                        </span>
                        <button
                          type="button"
                          className={notionStyles.optionVisibilityToggle}
                          onClick={() => toggleColumnOptionHidden(kind, index, option)}
                          title={isOptionHidden ? "Mostrar en los cuadros" : "Ocultar en los cuadros"}
                        >
                          {isOptionHidden ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                        </button>
                        {!isLockedSystemVariable ? (
                          <button type="button" onClick={() => removeColumnOption(kind, index, column as Column, option)}>×</button>
                        ) : (
                          <div aria-hidden style={{ width: 28, flexShrink: 0 }} />
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              <div className={notionStyles.optionCreateRow}>
                <input
                  className={notionStyles.optionCreateInput}
                  value={optionDrafts[column.id || `${kind}_${index}`] || ""}
                  placeholder={column.type === "Lugar" ? "Agregar apodo" : "Agregar variable"}
                  onChange={(event) => setOptionDrafts((prev) => ({ ...prev, [column.id || `${kind}_${index}`]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addColumnOption(kind, index, column as Column, optionDrafts[column.id || `${kind}_${index}`]);
                    }
                  }}
                />
                <button
                  type="button"
                  className={notionStyles.optionCreateBtn}
                  onClick={() => addColumnOption(kind, index, column as Column, optionDrafts[column.id || `${kind}_${index}`])}
                >
                  <FiPlus />
                </button>
              </div>
            </div>
          </>
        ) : null}
        <div className={notionStyles.propertyDivider} />
        <button className={column.pinned ? notionStyles.activePropertyAction : ""} onClick={() => toggleColumnPinned(kind, index)}><FiPaperclip /> Fijar {column.pinned ? <span>Activo</span> : null}</button>
        <button onClick={() => updateColumnOption(kind, index, { hidden: true })}><FiEyeOff /> Ocultar</button>
        <button className={column.fit ? notionStyles.activePropertyAction : ""} onClick={() => updateColumnOption(kind, index, { fit: !column.fit })}><FiArrowUpRight /> Ajustar contenido {column.fit ? <span>Activo</span> : null}</button>
        <div className={notionStyles.propertyDivider} />
        <button onClick={() => moveColumnOneStep(kind, index, "left")}><FiArrowLeft /> Mover a la izquierda</button>
        <button onClick={() => moveColumnOneStep(kind, index, "right")}><FiArrowRight /> Mover a la derecha</button>
        {kind === "custom" ? (
          <>
            <button onClick={() => duplicateCustomColumn(index)}><FiCopy /> Duplicar propiedad</button>
            <button className={notionStyles.deleteProperty} onClick={() => deleteCustomColumn(index)}>
              <FiTrash2 /> Eliminar propiedad
            </button>
          </>
        ) : (
          <button 
            className={`${notionStyles.deleteProperty} ${notionStyles.deletePropertyDisabled}`} 
            disabled
            title="Las propiedades base no se pueden eliminar"
          >
            <FiTrash2 /> Esta propiedad no se puede quitar
          </button>
        )}
      </div>,
      document.body
      )
    ) : null;

  const baseFieldMetas = baseColumns.map((column, index) => {
    const key = getColumnFieldKey(column, index, "base");
    // legacyKeys: si el key principal no es el id del campo, también buscamos por id (y viceversa)
    const legacyKeys: string[] = [];
    if (column.id && column.id !== key) legacyKeys.push(column.id);
    const slugKey = `base_${slugify(column.savedTitle || column.title || "field")}_${index + 1}`;
    if (slugKey !== key && !legacyKeys.includes(slugKey)) legacyKeys.push(slugKey);
    return {
      key,
      label: column.title,
      type: column.type,
      kind: "base" as const,
      index,
      options: Array.isArray(column.options) ? column.options : [],
      legacyKeys,
    };
  });

  const customFieldMetas = customColumns.map((column, index) => getCustomFieldMeta(column, index));
  const visibleBaseColumns = baseColumns.filter((column) => !column.hidden);
  const visibleCustomMetas = customFieldMetas.filter((field) => {
    const column = customColumns[field.index];
    return column && !column.hidden;
  });
  const visibleColumnCount = visibleBaseColumns.length + visibleCustomMetas.length;
  const visibilityColumns = useMemo(
    () =>
      [
        ...baseColumns.map((column, index) => ({ column, index, kind: "base" as const })),
        ...customColumns.map((column, index) => ({ column, index, kind: "custom" as const })),
      ].filter(({ column }) => column.title.toLowerCase().includes(visibilitySearch.trim().toLowerCase())),
    [baseColumns, customColumns, visibilitySearch]
  );
  const visibleVisibilityColumns = visibilityColumns.filter(({ column }) => !column.hidden);
  const hiddenVisibilityColumns = visibilityColumns.filter(({ column }) => column.hidden);

  const relationSourceColumns = useMemo(
    () => [...baseColumns, ...customColumns].filter((column) => column.type !== "Relación" && Array.isArray(column.options) && column.options.length > 0),
    [baseColumns, customColumns]
  );

  const getRelationOptions = (field: FieldMeta) => {
    const column = field.kind === "base" ? baseColumns[field.index] : customColumns[field.index];
    if (column && isAreaRelationColumn(column, field.kind)) {
      return mergeAreasVariables(systemAreaNames, column.options || []);
    }
    const sourceKey = column?.relationSource;
    const sourceColumn = relationSourceColumns.find((item) => (item.id || item.savedTitle || item.title) === sourceKey);
    return sourceColumn?.options || column?.options || [];
  };

  const allFieldMetas = useMemo(() => {
    const baseMetas = baseColumns.map((column, index) => ({
      key: getColumnFieldKey(column, index, "base"),
      label: column.title,
      type: column.type,
      kind: "base" as const,
      index,
      options: Array.isArray(column.options) ? column.options : [],
    }));
    const customMetas = customColumns.map((column, index) => getCustomFieldMeta(column, index));
    return [...baseMetas, ...customMetas];
  }, [baseColumns, customColumns]);

  const activeSort = useMemo(() => {
    const baseIndex = baseColumns.findIndex((column) => column.sort);
    if (baseIndex >= 0) return { kind: "base" as const, index: baseIndex, direction: baseColumns[baseIndex].sort };
    const customIndex = customColumns.findIndex((column) => column.sort);
    if (customIndex >= 0) return { kind: "custom" as const, index: customIndex, direction: customColumns[customIndex].sort };
    return null;
  }, [baseColumns, customColumns]);

  const filteredRows = useMemo(() => {
    let result = rows;
    
    // Filter by status if selected
    if (selectedStatus) {
      const statusField = allFieldMetas.find(meta => meta.type === "Estado");
      if (statusField) {
        result = result.filter(row => {
          const value = readTaskField(row, statusField);
          return value === selectedStatus;
        });
      }
    }
    
    // Filter by responsible if selected
    if (selectedResponsible) {
      const personasField = allFieldMetas.find(meta => meta.type === "Personas");
      if (personasField) {
        result = result.filter(row => {
          const value = readTaskField(row, personasField);
          if (typeof value === "string") {
            const people = value.split(",").map(p => p.trim());
            return people.includes(selectedResponsible);
          }
          return false;
        });
      }
    }

    if (selectedLocation) {
      const locationField = allFieldMetas.find(meta => meta.type === "Lugar");
      if (locationField) {
        result = result.filter(row => getLocationDisplayLabel(readTaskField(row, locationField)) === selectedLocation);
      }
    }

    if (selectedCheckbox !== null) {
      const checkboxField = allFieldMetas.find(meta => meta.type === "Casilla");
      if (checkboxField) {
        result = result.filter(row => isCheckboxChecked(readTaskField(row, checkboxField)) === selectedCheckbox);
      }
    }
    
    // Apply other filters
    if (activeFilters.length) {
      result = result.filter((row) => {
        return activeFilters.every((filterTitle) => {
          const field = allFieldMetas.find((meta) => meta.label === filterTitle);
          if (!field) return true;
          const value = readTaskField(row, field);
          if (value === null || value === undefined) return false;
          if (typeof value === "string") return value.trim().length > 0;
          if (typeof value === "object") {
            const label = getLocationDisplayLabel(value);
            return label.trim().length > 0;
          }
          return Boolean(value);
        });
      });
    }
    
    if (activeSort) {
      const sortColumn = activeSort.kind === "base" ? baseColumns[activeSort.index] : customColumns[activeSort.index];
      const sortField = activeSort.kind === "base" ? baseFieldMetas[activeSort.index] : customFieldMetas[activeSort.index];
      if (sortColumn && sortField) {
        result = sortRowsByStoredColumn(
          result,
          rows,
          sortColumn,
          (row) => readTaskField(row, sortField),
          getLocationDisplayLabel,
        );
      }
    }

    return result;
  }, [rows, selectedStatus, selectedResponsible, selectedLocation, selectedCheckbox, activeFilters, allFieldMetas, activeSort, baseFieldMetas, customFieldMetas]);

  const selectableFilteredIds = useMemo(
    () => filteredRows.map((row) => row.id).filter((id): id is string => Boolean(id)),
    [filteredRows],
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => selectedRows.includes(id));
  const someFilteredSelected =
    selectableFilteredIds.some((id) => selectedRows.includes(id)) && !allFilteredSelected;

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedRows((prev) => prev.filter((id) => !selectableFilteredIds.includes(id)));
      return;
    }
    setSelectedRows((prev) => Array.from(new Set([...prev, ...selectableFilteredIds])));
  };

  const getCellClassName = (rowIdx: number, colIdx: number, extra?: string) => {
    const isHoveredRow = highlightGrid && hoveredCell?.row === rowIdx;
    const isHoveredCol = highlightGrid && hoveredCell?.col === colIdx;
    return [extra, isHoveredRow ? notionStyles.highlightRowCell : "", isHoveredCol ? notionStyles.highlightColumnCell : ""]
      .filter(Boolean)
      .join(" ");
  };

  const toggleRowSelection = (row: Task) => {
    if (!row.id) return;
    setSelectedRows((prev) => prev.includes(row.id!) ? prev.filter((id) => id !== row.id) : [...prev, row.id!]);
  };

  const selectRowForDeletion = (row: Task) => {
    if (!row.id) return;
    setSelectedRows((prev) => prev.includes(row.id!) ? prev.filter((id) => id !== row.id) : [...prev, row.id!]);
  };

  const moveSelectedRows = (direction: "up" | "down") => {
    setRows((prev) => {
      const next = [...prev];
      const indices = selectedRows
        .map((id) => next.findIndex((r) => r.id === id))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);

      if (!indices.length) return prev;
      if (direction === "up") {
        if (indices[0] === 0) return prev;
        for (const idx of indices) {
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        }
      } else {
        if (indices[indices.length - 1] === next.length - 1) return prev;
        for (const idx of [...indices].reverse()) {
          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        }
      }
      const ids = next.map((r) => r.id).filter((id): id is string => Boolean(id));
      void reorderTasks(ids)
        .then(() => markTableChanged())
        .catch((err) => console.error("Error guardando orden de filas:", err));
      return next;
    });
  };

  const deleteSelectedRows = async () => {
    const ids = [...new Set(selectedRows.filter(Boolean))];
    if (!activeTabId || !ids.length) return;
    if (shouldCreatePreDeleteRevision(ids.length, rows.length)) {
      try {
        await flushAttachmentSaves();
        await createPreBulkDeleteRevision(activeTabId, rows.length, ids.length);
      } catch (err) {
        console.error("Error creando revisión de seguridad:", err);
      }
    }
    const idSet = new Set(ids);
    setSelectedRows([]);
    setRows((prev) => prev.filter((row) => !row.id || !idSet.has(row.id)));
    for (const id of ids) {
      await deleteTask(id).catch((err) => console.error("Error eliminando fila:", err));
    }
    await refreshTasks();
    markTableChanged();
  };

  const handleApplyHistoryRevision = async (tabId: string, revisionId: string) => {
    const result = await applyRevision(tabId, revisionId);
    if (tabId === activeTabId) {
      forceTasksReplaceRef.current = true;
      if (Array.isArray(result?.tasks)) {
        setRows(result.tasks as Task[]);
      }
      await Promise.all([refreshTasks(), refreshColumns()]);
    }
  };

  const handleRestoreLatestHistory = async (tabId: string) => {
    try {
      const result = await restoreLatestRevision(tabId);
      if (result?.restored && tabId === activeTabId) {
        forceTasksReplaceRef.current = true;
        if (Array.isArray(result?.tasks)) {
          setRows(result.tasks as Task[]);
        }
        await Promise.all([refreshTasks(), refreshColumns()]);
        showSnackbar("Última revisión con datos recuperada.", "success");
      } else if (!result?.restored) {
        showSnackbar(
          "No hay revisión con datos para recuperar, o la tabla ya tiene filas.",
          "warning",
        );
      }
    } catch {
      showSnackbar("No se pudo recuperar la revisión.", "error");
    }
  };

  const handleCreateManualHistoryRevision = async (tabId: string) => {
    await flushAttachmentSaves();
    await createManualRevision(tabId);
  };

  const handleAddRow = async () => {
    try {
      await flushAttachmentSaves();
      markTableChanged();
      const creatorName = auth.user?.displayName ?? auth.user?.username ?? "";
      await addTask({
        usuario: "",
        area: "",
        actividad: "",
        lugar: "",
        fecha: "",
        casilla: "",
        estado: "Sin empezar",
        createdBy: creatorName,
        lastEditedBy: creatorName,
      });
    } catch (err) {
      console.error("Error creando fila:", err);
    }
  };

  const handleAddRowBelow = async (clickedRow: Task) => {
    try {
      await flushAttachmentSaves();
      const prevIds = new Set(rows.map((r) => r.id));
      const creatorName = auth.user?.displayName ?? auth.user?.username ?? "";
      await addTask({
        usuario: "",
        area: "",
        actividad: "",
        lugar: "",
        fecha: "",
        casilla: "",
        estado: "Sin empezar",
        createdBy: creatorName,
        lastEditedBy: creatorName,
      });
      // After addTask, rows state will be updated by the hook. Re-order the new row to be after the clicked row.
      setTimeout(() => {
        setRows((prev) => {
          const newTask = prev.find((r) => r.id && !prevIds.has(r.id));
          if (!newTask) return prev;
          const without = prev.filter((r) => r.id !== newTask.id);
          const clickedIdx = without.findIndex((r) => r.id === clickedRow.id);
          const next = clickedIdx === -1
            ? [...without, newTask]
            : [...without.slice(0, clickedIdx + 1), newTask, ...without.slice(clickedIdx + 1)];
          const ids = next.map((r) => r.id).filter((id): id is string => Boolean(id));
          void reorderTasks(ids)
            .then(() => markTableChanged())
            .catch((err) => console.error("Error guardando orden de filas:", err));
          return next;
        });
      }, 100);
    } catch (err) {
      console.error("Error creando fila:", err);
    }
  };

  const [draggedRow, setDraggedRow] = useState<number | null>(null);
  const dragOrderChangedRef = useRef(false);

  const handleRowDragStart = (rowIdx: number) => {
    setDraggedRow(rowIdx);
    dragOrderChangedRef.current = false;
  };

  const handleRowDragOver = (e: React.DragEvent, rowIdx: number) => {
    e.preventDefault();
    if (draggedRow === null || draggedRow === rowIdx) return;
    dragOrderChangedRef.current = true;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedRow, 1);
      next.splice(rowIdx, 0, moved);
      return next;
    });
    setDraggedRow(rowIdx);
  };

  const handleRowDragEnd = () => {
    const orderChanged = dragOrderChangedRef.current;
    setDraggedRow(null);
    dragOrderChangedRef.current = false;
    if (!orderChanged) return;
    setRows((currentRows) => {
      const ids = currentRows.map((r) => r.id).filter((id): id is string => Boolean(id));
      void reorderTasks(ids)
        .then(() => markTableChanged())
        .catch((err) => console.error("Error guardando orden de filas:", err));
      return currentRows;
    });
  };

  const exportTable = (format: "xlsx" | "pdf") => {
    const visibleFields = [
      ...baseFieldMetas.filter((field) => !baseColumns[field.index]?.hidden),
      ...customFieldMetas.filter((field) => !customColumns[field.index]?.hidden),
    ];
    const headers = visibleFields.map((field) => field.label);
    const body = filteredRows.map((row) =>
      visibleFields.map((field) => {
        const value = readTaskField(row, field);
        if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? JSON.stringify(item) : String(item)).join(", ");
        if (typeof value === "object" && value !== null) return getLocationDisplayLabel(value) || JSON.stringify(value);
        return value === null || value === undefined ? "" : String(value);
      })
    );
    const exportDate = new Date().toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" });
    const fileName = slugify(tableTitle || "actividades") || "actividades";

    if (format === "pdf") {
      const orientation = headers.length > 7 ? "landscape" : "portrait";
      const doc = new jsPDF({ orientation });
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text(tableTitle || "Actividades Planificadas", 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Exportado: ${exportDate} · ${body.length} filas · ${headers.length} columnas`, 14, 22);
      autoTable(doc, {
        startY: 26,
        head: [headers],
        body,
        styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
        headStyles: { fillColor: [14, 165, 233], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 249, 247] },
      });
      doc.save(`${fileName}.pdf`);
      setShowExportMenu(false);
      return;
    }

    const titleRow = [tableTitle || "Actividades Planificadas"];
    const subtitleRow = [`Exportado: ${exportDate} · ${body.length} filas · ${headers.length} columnas`];
    const worksheet = XLSX.utils.aoa_to_sheet([titleRow, subtitleRow, [], headers, ...body]);
    const headerRowIndex = 3;
    worksheet["!cols"] = headers.map((header, index) => ({
      wch: Math.min(48, Math.max(header.length + 5, ...body.map((row) => String(row[index] || "").length + 3))),
    }));
    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(headers.length - 1, 0) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(headers.length - 1, 0) } },
    ];
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: Math.max(headerRowIndex, headerRowIndex + body.length), c: Math.max(headers.length - 1, 0) } }) };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 4 };
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    const border = {
      top: { style: "thin", color: { rgb: "D7E5DF" } },
      bottom: { style: "thin", color: { rgb: "D7E5DF" } },
      left: { style: "thin", color: { rgb: "D7E5DF" } },
      right: { style: "thin", color: { rgb: "D7E5DF" } },
    };
    const titleCell = worksheet["A1"];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "0F766E" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
    const subtitleCell = worksheet["A2"];
    if (subtitleCell) {
      subtitleCell.s = {
        font: { italic: true, color: { rgb: "64748B" } },
        fill: { fgColor: { rgb: "ECFDF5" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: headerRowIndex, c: col })];
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "0EA5E9" } },
          alignment: { horizontal: "center", vertical: "center" },
          border,
        };
      }
    }
    for (let row = headerRowIndex + 1; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
        if (!cell) continue;
        const rawValue = String(cell.v || "").toLowerCase();
        const statusFill =
          rawValue === "completado" ? "DBEAFE" :
          rawValue === "listo" ? "D1FAE5" :
          rawValue === "sin empezar" ? "F3F4F6" :
          row % 2 === 0 ? "F8FAFC" : "FFFFFF";
        cell.s = {
          fill: { fgColor: { rgb: statusFill } },
          alignment: { vertical: "center", wrapText: true },
          border,
        };
      }
    }
    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: tableTitle,
      Subject: "Exportación de tabla",
      Author: "DashBoard",
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(workbook, worksheet, "Actividades");
    XLSX.writeFile(workbook, `${fileName}.xlsx`, { bookType: "xlsx" });
    setShowExportMenu(false);
  };

  return (
    <div
      className={`${styles.page} ${poppins.className} ${collapsed ? styles.collapsed : ""} ${darkMode ? styles.dark : ""} ${
        sidebarRight ? styles.sidebarRight : ""
      }`}
      onClick={() => {
        setShowColumnMenu(false);
        setShowVisibilityMenu(false);
        setActiveColumnMenu(null);
        setPropertyMenuPosition(null);
      }}
    >
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

      <main className={styles.main}>
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
        <div className={styles.content}>
          <div className={`${styles.panel} ${notionStyles.notionPanel}`}>
            <div ref={tabsBarRef} className={tabChrome.notionTabsBar} data-notion-menu-root>
              {notionTabs.map((tab, i) => {
                const isSharedWithMe = tab.isShared === true;
                const sharedFrom = tab.sharedFrom;
                const outbound = outboundSharesByTab[tab.id] ?? [];
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
                const tabHintBase = tabShareHint ? `${tab.title} · ${tabShareHint}` : tab.title;
                const tabTitleAttr = `${tabHintBase}. Las fijadas van primero. Mantén pulsado para reordenar solo entre fijadas o solo entre el resto. Clic derecho o ⋮ para opciones.`;
                const tabBtnClass =
                  tab.id === activeTabId
                    ? `${tabChrome.notionTabActive}${draggingTabId === tab.id ? ` ${tabChrome.notionTabDragging}` : ""}`
                    : `${tabChrome.notionTab}${draggingTabId === tab.id ? ` ${tabChrome.notionTabDragging}` : ""}`;
                return (
                  <React.Fragment key={tab.id}>
                    {draggingTabId && dragHoverIndex === i ? (
                      <span className={tabChrome.tabDropIndicator} aria-hidden />
                    ) : null}
                    <button
                      type="button"
                      data-notion-tab-id={tab.id}
                      className={tabBtnClass}
                      onClick={() => {
                        if (suppressNextTabClickRef.current) {
                          suppressNextTabClickRef.current = false;
                          return;
                        }
                        setActiveTabId(tab.id);
                        setSelectedRows([]);
                        setActiveFilters([]);
                        clearAllViewFilters();
                        setActiveColumnMenu(null);
                        setPropertyMenuPosition(null);
                      }}
                      onPointerDown={(e) => onNotionTabPointerDown(e, tab.id)}
                      onPointerMove={onNotionTabPointerMove}
                      onPointerUp={onNotionTabPointerUp}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openNotionTabMenuBelowEl(tab.id, e.currentTarget);
                      }}
                      title={tabTitleAttr}
                    >
                      {tab.pinned ? (
                        <span className={tabChrome.notionTabPinWrap} title="Fijada">
                          <FiBookmark className={tabChrome.notionTabPinIcon} aria-hidden />
                        </span>
                      ) : null}
                      <FiLayers className={tabChrome.notionTabIcon} />
                      <span className={tabChrome.notionTabTitleCluster}>
                        <span className={tabChrome.notionTabTitleText}>{tab.title}</span>
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
                      <button
                        type="button"
                        className={tabChrome.notionTabMenuTrigger}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openNotionTabMenuBelowEl(tab.id, ev.currentTarget);
                        }}
                        title="Opciones de la pestaña"
                        aria-label="Opciones de la pestaña"
                      >
                        <FiMoreVertical size={14} />
                      </button>
                      {notionTabs.length > 1 && !isSharedByOwner ? (
                        <span
                          className={tabChrome.notionTabClose}
                          onPointerDown={(ev) => ev.stopPropagation()}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleDeleteNotionTab(tab.id);
                          }}
                        >
                          ×
                        </span>
                      ) : null}
                    </button>
                    {i === notionPinnedCount - 1 && notionPinnedCount > 0 && notionPinnedCount < notionTabs.length ? (
                      <span className={tabChrome.notionTabsPinDivider} aria-hidden />
                    ) : null}
                  </React.Fragment>
                );
              })}
              {draggingTabId &&
              dragHoverIndex === notionTabs.length &&
              !notionTabs.some((t) => t.id === draggingTabId && t.pinned === true) ? (
                <span className={tabChrome.tabDropIndicator} aria-hidden />
              ) : null}
              <button type="button" className={tabChrome.notionTabAdd} onClick={handleCreateNotionTab} title="Crear nueva tabla">
                <FiPlus />
              </button>
              <button
                type="button"
                className={tabChrome.notionTabHistory}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistoryPanel(true);
                }}
                title="Historial"
              >
                <FiRotateCcw />
              </button>
              <button
                type="button"
                className={tabChrome.notionTabTrash}
                onClick={(e) => { e.stopPropagation(); setShowTrashPanel(!showTrashPanel); }}
                title="Papelera"
              >
                <FiTrash2 />
                {notionTrash.length > 0 && <span className={tabChrome.trashBadge}>{notionTrash.length}</span>}
              </button>
              {notionTabMenu ? (() => {
                const mt = notionTabs.find((t) => t.id === notionTabMenu.tabId);
                const mi = notionTabs.findIndex((t) => t.id === notionTabMenu.tabId);
                if (!mt) return null;
                const menuOutbound = outboundSharesByTab[mt.id] ?? [];
                const menuIsSharedByOwner = !(mt.isShared === true) && menuOutbound.length > 0;
                const canDelete = notionTabs.length > 1 && !menuIsSharedByOwner;
                return (
                  <>
                    <div
                      className={tabChrome.notionTabMenuBackdrop}
                      onClick={() => setNotionTabMenu(null)}
                      aria-hidden
                    />
                    <div
                      role="menu"
                      className={tabChrome.notionTabMenu}
                      style={{ left: notionTabMenu.left, top: notionTabMenu.top }}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {!(mt.isShared === true) && (
                        <button
                          type="button"
                          role="menuitem"
                          className={tabChrome.notionTabMenuItem}
                          onClick={() => {
                            setNotionTabMenu(null);
                            openShareModal({ id: mt.id, title: mt.title });
                          }}
                        >
                          Compartir…
                        </button>
                      )}
                      {menuIsSharedByOwner && (
                        <button
                          type="button"
                          role="menuitem"
                          className={tabChrome.notionTabMenuItemDanger}
                          onClick={async () => {
                            if (!auth.user?.id) return;
                            setNotionTabMenu(null);
                            try {
                              const res = await fetch(resolveSharesApi(), {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ tabId: mt.id, ownerId: auth.user.id }),
                              });
                              if (!res.ok) return;
                              await refreshOutboundSharesByTab();
                              await syncSharesForTab(mt.id);
                              window.dispatchEvent(new CustomEvent("notion-tabs-updated"));
                            } catch {
                              /* noop */
                            }
                          }}
                        >
                          Dejar de compartir
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className={tabChrome.notionTabMenuItem}
                        onClick={() => void handleDuplicateNotionTabFromMenu(mt.id)}
                      >
                        Duplicar como tabla personal
                      </button>
                      <p className={tabChrome.notionTabMenuHint}>Si la tabla era compartida contigo, la copia es solo tuya.</p>
                      <button
                        type="button"
                        role="menuitem"
                        className={tabChrome.notionTabMenuItem}
                        onClick={() => void handleSetNotionTabPinned(mt.id, !mt.pinned)}
                      >
                        {mt.pinned ? "Desfijar pestaña" : "Fijar pestaña"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={tabChrome.notionTabMenuItem}
                        disabled={mt.pinned ? mi <= 0 : mi <= notionPinnedCount}
                        onClick={() => void commitMoveNotionTab(mt.id, -1)}
                      >
                        Mover a la izquierda
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={tabChrome.notionTabMenuItem}
                        disabled={mt.pinned ? mi >= notionPinnedCount - 1 : mi >= notionTabs.length - 1}
                        onClick={() => void commitMoveNotionTab(mt.id, 1)}
                      >
                        Mover a la derecha
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={tabChrome.notionTabMenuItemDanger}
                        disabled={!canDelete}
                        onClick={() => {
                          setNotionTabMenu(null);
                          handleDeleteNotionTab(mt.id);
                        }}
                        title={menuIsSharedByOwner ? "Debes dejar de compartir esta pestaña antes de eliminarla" : undefined}
                      >
                        {menuIsSharedByOwner ? "Eliminar (compartida)…" : "Eliminar…"}
                      </button>
                      {menuIsSharedByOwner && (
                        <p className={tabChrome.notionTabMenuHint}>Para eliminar esta pestaña, primero deja de compartirla.</p>
                      )}
                    </div>
                  </>
                );
              })() : null}
            </div>
            <div className={notionStyles.notionPanelScroll}>
              <div className={notionStyles.notionScrollInner}>
            <div className={`${styles.panelHeader} ${notionStyles.notionPanelHeader}`}>
              <div style={{ width: "100%" }}>
                <h2 className={styles.panelTitle}>
                  <input
                    className={notionStyles.editableTitle}
                    value={tableTitle}
                    onChange={(e) => handleRenameNotionTab(e.target.value)}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || "Actividades Planificadas";
                      if (next !== e.target.value) handleRenameNotionTab(next);
                      flushRenameNotionTab(next);
                    }}
                  />
                </h2>
                <div className={notionStyles.filterBar}>
                  {selectedRows.length > 0 ? (
                    <>
                      <div className={notionStyles.selectionToolbar}>
                        <span className={notionStyles.selectionCount}>{selectedRows.length} seleccionados</span>
                        <button type="button" onClick={() => moveSelectedRows("up")}>
                          <FiArrowUp /> Subir
                        </button>
                        <button type="button" onClick={() => moveSelectedRows("down")}>
                          <FiArrowDown /> Bajar
                        </button>
                        <button type="button" onClick={deleteSelectedRows}>
                          <FiTrash2 /> Eliminar filas
                        </button>
                        <button type="button" onClick={() => setSelectedRows([])}>Cancelar</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button 
                        type="button" 
                        className={!hasActiveViewFilters ? notionStyles.filterChipActive : notionStyles.filterChip}
                        onClick={clearAllViewFilters}
                      >
                        <FiCheckCircle /> Todas las tareas
                      </button>
                      {baseColumns.some(col => col.type === "Estado" && !col.hidden) || customColumns.some(col => col.type === "Estado" && !col.hidden) ? (
                        <div style={{ position: "relative" }}>
                          <button 
                            type="button" 
                            className={selectedStatus ? notionStyles.filterChipActive : notionStyles.filterChip}
                            onClick={() => setOpenFilterMenu((prev) => (prev === "status" ? null : "status"))}
                          >
                            <FiLayers /> Por estado {selectedStatus ? `: ${selectedStatus}` : ""}
                          </button>
                          {openFilterMenu === "status" && (() => {
                            const statusColumn = [...baseColumns, ...customColumns].find(col => col.type === "Estado" && !col.hidden);
                            const statusField = allFieldMetas.find(meta => meta.type === "Estado");
                            
                            // Collect all unique status values from tasks
                            const statusesFromTasks = new Set<string>();
                            if (statusField) {
                              rows.forEach(row => {
                                const value = readTaskField(row, statusField);
                                if (value && typeof value === "string" && value.trim()) {
                                  statusesFromTasks.add(value.trim());
                                }
                              });
                            }
                            
                            // Combine predefined options with values from tasks
                            const predefinedOptions = statusColumn?.options || [];
                            const allStatusOptions = Array.from(new Set([...predefinedOptions, ...statusesFromTasks])).sort();
                            
                            return (
                              <div className={notionStyles.viewFilterDropdown}>
                                <button
                                  type="button"
                                  className={!selectedStatus ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => {
                                    setSelectedStatus(null);
                                    setOpenFilterMenu(null);
                                  }}
                                >
                                  Todos los estados
                                </button>
                                {allStatusOptions.map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    className={selectedStatus === status ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                    onClick={() => {
                                      setSelectedStatus(status);
                                      setOpenFilterMenu(null);
                                    }}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                      {baseColumns.some(col => col.type === "Personas" && !col.hidden) || customColumns.some(col => col.type === "Personas" && !col.hidden) ? (
                        <div style={{ position: "relative" }}>
                          <button 
                            type="button" 
                            className={selectedResponsible ? notionStyles.filterChipActive : notionStyles.filterChip}
                            onClick={() => setOpenFilterMenu((prev) => (prev === "responsible" ? null : "responsible"))}
                          >
                            <FiUser /> Responsable {selectedResponsible ? `: ${selectedResponsible}` : ""}
                          </button>
                          {openFilterMenu === "responsible" && (() => {
                            const personasColumn = [...baseColumns, ...customColumns].find(col => col.type === "Personas" && !col.hidden);
                            const personasField = allFieldMetas.find(meta => meta.type === "Personas");
                            
                            // Collect all unique people values from tasks
                            const peopleFromTasks = new Set<string>();
                            if (personasField) {
                              rows.forEach(row => {
                                const value = readTaskField(row, personasField);
                                if (value && typeof value === "string" && value.trim()) {
                                  // Split by comma in case multiple people are assigned
                                  const people = value.split(",").map(p => p.trim()).filter(p => p);
                                  people.forEach(person => peopleFromTasks.add(person));
                                }
                              });
                            }
                            
                            // Combine predefined options with values from tasks
                            const predefinedOptions = mergePersonasVariables(
                              systemPersonaNames,
                              personasColumn?.options || [],
                            );
                            const allPeopleOptions = Array.from(new Set([...predefinedOptions, ...peopleFromTasks])).sort((a, b) =>
                              a.localeCompare(b, "es"),
                            );
                            
                            return (
                              <div className={notionStyles.viewFilterDropdown}>
                                <button
                                  type="button"
                                  className={!selectedResponsible ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => {
                                    setSelectedResponsible(null);
                                    setOpenFilterMenu(null);
                                  }}
                                >
                                  Todos los responsables
                                </button>
                                {allPeopleOptions.map((person) => (
                                  <button
                                    key={person}
                                    type="button"
                                    className={selectedResponsible === person ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                    onClick={() => {
                                      setSelectedResponsible(person);
                                      setOpenFilterMenu(null);
                                    }}
                                  >
                                    {person}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                      {baseColumns.some(col => col.type === "Lugar" && !col.hidden) || customColumns.some(col => col.type === "Lugar" && !col.hidden) ? (
                        <div style={{ position: "relative" }}>
                          <button 
                            type="button" 
                            className={selectedLocation ? notionStyles.filterChipActive : notionStyles.filterChip}
                            onClick={() => setOpenFilterMenu((prev) => (prev === "location" ? null : "location"))}
                          >
                            <FiMapPin /> Lugar {selectedLocation ? `: ${selectedLocation}` : ""}
                          </button>
                          {openFilterMenu === "location" && (() => {
                            const locationField = allFieldMetas.find(meta => meta.type === "Lugar");
                            const locationsFromTasks = new Set<string>();
                            if (locationField) {
                              rows.forEach(row => {
                                const label = getLocationDisplayLabel(readTaskField(row, locationField)).trim();
                                if (label) locationsFromTasks.add(label);
                              });
                            }
                            const locationColumn = [...baseColumns, ...customColumns].find(col => col.type === "Lugar" && !col.hidden);
                            const predefinedOptions = locationColumn?.options || [];
                            const allLocationOptions = Array.from(new Set([...predefinedOptions, ...locationsFromTasks])).sort();
                            return (
                              <div className={notionStyles.viewFilterDropdown}>
                                <button
                                  type="button"
                                  className={!selectedLocation ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                  onClick={() => {
                                    setSelectedLocation(null);
                                    setOpenFilterMenu(null);
                                  }}
                                >
                                  Todos los lugares
                                </button>
                                {allLocationOptions.map((location) => (
                                  <button
                                    key={location}
                                    type="button"
                                    className={selectedLocation === location ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                    onClick={() => {
                                      setSelectedLocation(location);
                                      setOpenFilterMenu(null);
                                    }}
                                  >
                                    {location}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                      {baseColumns.some(col => col.type === "Casilla" && !col.hidden) || customColumns.some(col => col.type === "Casilla" && !col.hidden) ? (
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            className={selectedCheckbox !== null ? notionStyles.filterChipActive : notionStyles.filterChip}
                            onClick={() => setOpenFilterMenu((prev) => (prev === "checkbox" ? null : "checkbox"))}
                          >
                            <FiCheckCircle /> Casilla {selectedCheckbox === true ? ": Marcadas" : selectedCheckbox === false ? ": Sin marcar" : ""}
                          </button>
                          {openFilterMenu === "checkbox" && (
                            <div className={notionStyles.viewFilterDropdown}>
                              <button
                                type="button"
                                className={selectedCheckbox === null ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => {
                                  setSelectedCheckbox(null);
                                  setOpenFilterMenu(null);
                                }}
                              >
                                Todas
                              </button>
                              <button
                                type="button"
                                className={selectedCheckbox === true ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => {
                                  setSelectedCheckbox(true);
                                  setOpenFilterMenu(null);
                                }}
                              >
                                Marcadas ✓
                              </button>
                              <button
                                type="button"
                                className={selectedCheckbox === false ? notionStyles.viewFilterOptionActive : notionStyles.viewFilterOption}
                                onClick={() => {
                                  setSelectedCheckbox(false);
                                  setOpenFilterMenu(null);
                                }}
                              >
                                Sin marcar
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className={notionStyles.gridToggleBtn}
                        onClick={openSharedWithMe}
                        title="Ver tablas compartidas contigo"
                      >
                        <FiUserCheck /> Compartidos
                      </button>
                      {!(activeNotionTab?.isShared === true) && (
                        <button
                          type="button"
                          className={notionStyles.gridToggleBtn}
                          onClick={() => openShareModal({ id: activeTabId, title: tableTitle })}
                          title="Compartir esta tabla"
                        >
                          <FiShare2 /> Compartir
                        </button>
                      )}
                      {(auth.role === "admin" || auth.role === "dev") && (
                        <button
                          type="button"
                          className={notionStyles.gridToggleBtn}
                          onClick={() => { setShowAreasPanel(true); setAreasEditUser(null); }}
                          title="Gestionar áreas de personas"
                        >
                          <FiUsers /> Áreas
                        </button>
                      )}
                      <div
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        {activeShareChips.incoming ? (
                          <span
                            className={notionStyles.filterChip}
                            style={{
                              pointerEvents: "none",
                              borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))",
                              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                              color: "var(--accent)",
                              fontWeight: 600,
                              maxWidth: 280,
                              overflow: "hidden",
                            }}
                            title={`Esta tabla te fue compartida por ${activeShareChips.incoming}`}
                          >
                            <FiUserCheck size={12} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              Recibida · {activeShareChips.incoming}
                            </span>
                          </span>
                        ) : null}
                        {activeShareChips.outgoing ? (
                          <span
                            className={notionStyles.filterChip}
                            style={{
                              pointerEvents: "none",
                              borderColor: "var(--border)",
                              background: "color-mix(in srgb, var(--text-dim) 8%, transparent)",
                              color: "var(--text-dim)",
                              fontWeight: 600,
                              maxWidth: 280,
                              overflow: "hidden",
                            }}
                            title={`Compartida con: ${activeShareChips.outgoing}`}
                          >
                            <FiShare2 size={12} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              Compartida · {activeShareChips.outgoing}
                            </span>
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className={`${notionStyles.gridToggleBtn} ${highlightGrid ? notionStyles.gridToggleBtnActive : ""}`}
                          onClick={() => setHighlightGrid((prev) => !prev)}
                        >
                          <FiSliders /> Guía de celdas
                        </button>
                        <div className={notionStyles.exportMenuWrap} data-notion-menu-root>
                          <button
                            type="button"
                            className={notionStyles.gridToggleBtn}
                            title="Exportar tabla"
                            onClick={(event) => {
                              event.stopPropagation();
                              setShowExportMenu((prev) => !prev);
                            }}
                          >
                            <FiDownload /> Exportar
                          </button>
                          {showExportMenu ? (
                            <div className={notionStyles.exportMenu} onClick={(event) => event.stopPropagation()}>
                              <button type="button" onClick={() => exportTable("xlsx")}>Excel</button>
                              <button type="button" onClick={() => exportTable("pdf")}>PDF</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

            </div>
            <div className={`${styles.panelBody} ${notionStyles.notionPanelBody}`}>
              <table className={notionStyles.notionTable}>
                <thead>
                  <tr>
                    <th className={notionStyles.rowSelectorHeader}>
                      <div className={notionStyles.rowSelectorHeaderInner}>
                        <div className={notionStyles.rowSelectorHeaderActions}>
                          <button
                            type="button"
                            className={
                              allFilteredSelected
                                ? notionStyles.rowSelectorBtnActive
                                : someFilteredSelected
                                  ? notionStyles.rowSelectorHeaderBtnIndeterminate
                                  : notionStyles.rowSelectorHeaderBtn
                            }
                            onClick={toggleSelectAllFiltered}
                            disabled={selectableFilteredIds.length === 0}
                            aria-label={allFilteredSelected ? "Deseleccionar todas las filas visibles" : "Seleccionar todas las filas visibles"}
                            title={allFilteredSelected ? "Deseleccionar todas" : "Seleccionar todas"}
                          >
                            {allFilteredSelected ? "✓" : someFilteredSelected ? "−" : ""}
                          </button>
                        </div>
                      </div>
                    </th>
                    {baseColumns.map((column, index) => column.hidden ? null : (
                      <th
                        key={`base-${index}-${column.id || column.savedTitle || column.title}`}
                        className={`${notionStyles.customColumnHeader} ${notionStyles.baseColumnHeader} ${column.pinned ? notionStyles.pinnedColumnHeader : ""} ${column.filter || column.sort || column.group ? notionStyles.markedColumnHeader : ""} ${columnDropTarget?.kind === "base" && columnDropTarget.index === index ? (columnDropTarget.side === "before" ? notionStyles.columnDropBefore : notionStyles.columnDropAfter) : ""}`}
                        data-notion-menu-root
                        draggable
                        style={column.fit ? { width: "1%", minWidth: "max-content" } : column.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : index === 3 ? { width: "150px" } : index === 4 ? { width: "140px" } : undefined}
                        onDragStart={() => {
                          setActiveColumnMenu(null);
                          setPropertyMenuPosition(null);
                          setDraggedColumn({ kind: "base", index });
                        }}
                        onDragOver={(event) => handleColumnDragOver(event, "base", index)}
                        onDrop={() => handleColumnDrop("base", index, columnDropTarget?.kind === "base" && columnDropTarget.index === index ? columnDropTarget.side : "before")}
                        onClick={(event) => openColumnPropertyMenu(event, "base", index)}
                        onContextMenu={(event) => openColumnPropertyMenu(event, "base", index)}
                        onDragEnd={() => {
                          setDraggedColumn(null);
                          setColumnDropTarget(null);
                        }}
                      >
                        <span className={notionStyles.customColumnTitle}>
                          {column.icon}
                          {column.type === "Casilla" && column.width && column.width < 40 ? "" : column.title}
                        </span>
                        {renderPropertyMenu("base", index, column as { title: string; savedTitle: string; type: string; icon: ReactNode; hidden: boolean; pinned: boolean; fit: boolean; filter: boolean; sort: string; group: boolean; calculate: string; relationSource?: string })}
                        <span
                          className={notionStyles.columnResizeHandle}
                          onMouseDown={(event) => startColumnResize(event, "base", index, column.width)}
                        />
                      </th>
                    ))}
                    {customColumns.map((column, index) => column.hidden ? null : (
                      <th
                        key={`custom-${index}-${column.id || column.savedTitle || column.title}`}
                        className={`${notionStyles.customColumnHeader} ${column.pinned ? notionStyles.pinnedColumnHeader : ""} ${column.filter || column.sort || column.group ? notionStyles.markedColumnHeader : ""} ${columnDropTarget?.kind === "custom" && columnDropTarget.index === index ? (columnDropTarget.side === "before" ? notionStyles.columnDropBefore : notionStyles.columnDropAfter) : ""}`}
                        data-notion-menu-root
                        draggable
                        style={column.fit ? { width: "1%", minWidth: "max-content" } : column.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined}
                        onDragStart={() => {
                          setActiveColumnMenu(null);
                          setPropertyMenuPosition(null);
                          setDraggedColumn({ kind: "custom", index });
                        }}
                        onDragOver={(event) => handleColumnDragOver(event, "custom", index)}
                        onDrop={() => handleColumnDrop("custom", index, columnDropTarget?.kind === "custom" && columnDropTarget.index === index ? columnDropTarget.side : "before")}
                        onClick={(event) => openColumnPropertyMenu(event, "custom", index)}
                        onContextMenu={(event) => openColumnPropertyMenu(event, "custom", index)}
                        onDragEnd={() => {
                          setDraggedColumn(null);
                          setColumnDropTarget(null);
                        }}
                      >
                        <span className={notionStyles.customColumnTitle}>
                          {column.icon}
                          {column.type === "Casilla" && column.width && column.width < 40 ? "" : column.title}
                        </span>
                        {renderPropertyMenu("custom", index, column as { title: string; savedTitle: string; type: string; icon: ReactNode; hidden: boolean; pinned: boolean; fit: boolean; filter: boolean; sort: string; group: boolean; calculate: string; relationSource?: string })}
                        <span
                          className={notionStyles.columnResizeHandle}
                          onMouseDown={(event) => startColumnResize(event, "custom", index, column.width)}
                        />
                      </th>
                    ))}
                    <th
                      className={`${notionStyles.addColumnHeader} ${columnDropTarget?.kind === "custom" && columnDropTarget.index === customColumns.length ? notionStyles.columnDropBefore : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (draggedColumn) setColumnDropTarget({ kind: "custom", index: customColumns.length, side: "before" });
                      }}
                      onDrop={() => handleColumnDrop("custom", customColumns.length, "before")}
                    >
                      <div className={notionStyles.addColumnActions}>
                        <button
                          ref={addColumnButtonRef}
                          type="button"
                          className={notionStyles.addColumnButton}
                          data-notion-menu-root
                          onClick={(event) => {
                            event.stopPropagation();
                            setShowColumnMenu((prev) => !prev);
                            setShowVisibilityMenu(false);
                            setActiveColumnMenu(null);
                          }}
                          aria-label="Agregar columna"
                        >
                          <FiPlus />
                        </button>
                        <button
                          type="button"
                          className={notionStyles.addColumnButton}
                          data-notion-menu-root
                          onClick={(event) => {
                            event.stopPropagation();
                            setShowVisibilityMenu((prev) => !prev);
                            setShowColumnMenu(false);
                            setActiveColumnMenu(null);
                          }}
                          aria-label="Visibilidad de columnas"
                        >
                          <FiMoreHorizontal />
                        </button>
                      </div>
                      {showColumnMenu && menuPosition && (
                        <div
                          className={notionStyles.columnMenu}
                          data-notion-menu-root
                          style={{ top: `${menuPosition.top}px`, right: `${menuPosition.right}px` }}
                          onClick={(event) => event.stopPropagation()}
                          onWheel={(event) => {
                            event.stopPropagation();
                            event.currentTarget.scrollTop += event.deltaY;
                          }}
                        >
                          <div className={notionStyles.columnMenuSearch}>
                            <span>Selecciona el tipo</span>
                            <FiSearch />
                          </div>
                          <div className={notionStyles.columnMenuGrid}>
                            {columnTypes.map((type) => (
                              <button
                                key={type.label}
                                type="button"
                                className={notionStyles.columnTypeButton}
                                onClick={() => handleAddColumn(type)}
                              >
                                {type.icon}
                                <span>{type.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {showVisibilityMenu && menuPosition && (
                        <div
                          className={notionStyles.visibilityMenu}
                          data-notion-menu-root
                          style={{ top: `${menuPosition.top}px`, right: `${menuPosition.right}px` }}
                          onClick={(event) => event.stopPropagation()}
                          onWheel={(event) => {
                            event.stopPropagation();
                            event.currentTarget.scrollTop += event.deltaY;
                          }}
                        >
                          <div className={notionStyles.visibilityHeader}>
                            <button type="button" onClick={() => setShowVisibilityMenu(false)}><FiArrowLeft /></button>
                            <strong>Visibilidad de la propiedad</strong>
                            <button type="button" onClick={() => setShowVisibilityMenu(false)}>×</button>
                          </div>
                          <input
                            className={notionStyles.visibilitySearch}
                            value={visibilitySearch}
                            onChange={(event) => setVisibilitySearch(event.target.value)}
                            placeholder="Buscar una propiedad..."
                            autoFocus
                          />
                          <div className={notionStyles.visibilitySectionHeader}>
                            <span>Visibles en la tabla</span>
                            <button type="button" onClick={() => visibilityColumns.forEach(({ kind, index, column }) => !column.hidden && updateColumnOption(kind, index, { hidden: true }))}>Ocultar todo</button>
                          </div>
                          <div className={notionStyles.visibilityList}>
                            {visibleVisibilityColumns.map(({ column, kind, index }, listIndex) => (
                              <button
                                key={`visible-${listIndex}-${kind}-${index}-${column.id || column.savedTitle || column.title}`}
                                type="button"
                                className={notionStyles.visibilityItem}
                                onClick={() => updateColumnOption(kind, index, { hidden: true })}
                              >
                                <FiMoreVertical />
                                <span className={notionStyles.visibilityIcon}>{column.icon || getIconForType(column.type)}</span>
                                <span>{column.title}</span>
                                <FiEye />
                              </button>
                            ))}
                          </div>
                          <div className={notionStyles.visibilitySectionHeader}>
                            <span>Ocultas en el tabla</span>
                            <button type="button" onClick={() => visibilityColumns.forEach(({ kind, index, column }) => column.hidden && updateColumnOption(kind, index, { hidden: false }))}>Mostrar todo</button>
                          </div>
                          <div className={notionStyles.visibilityList}>
                            {hiddenVisibilityColumns.map(({ column, kind, index }, listIndex) => (
                              <button
                                key={`hidden-${listIndex}-${kind}-${index}-${column.id || column.savedTitle || column.title}`}
                                type="button"
                                className={notionStyles.visibilityItem}
                                onClick={() => updateColumnOption(kind, index, { hidden: false })}
                              >
                                <FiMoreVertical />
                                <span className={notionStyles.visibilityIcon}>{column.icon || getIconForType(column.type)}</span>
                                <span>{column.title}</span>
                                <FiEyeOff />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, displayIdx) => {
                    const sourceRowIdx = rows.indexOf(row);
                    if (sourceRowIdx < 0) return null;
                    return (
                    <tr
                      key={row.id ?? `row-${sourceRowIdx}`}
                      className={row.id && selectedRows.includes(row.id) ? notionStyles.selectedDataRow : ""}
                      onDragOver={(e) => handleRowDragOver(e, sourceRowIdx)}
                    >
                      <td className={notionStyles.rowSelectorCell}>
                        <div className={notionStyles.rowActionsContainer}>
                          <button
                            type="button"
                            className={notionStyles.rowActionBtn}
                            onClick={() => handleAddRowBelow(row)}
                            title="Añadir fila debajo"
                          >
                            <FiPlus size={12} />
                          </button>
                          <span
                            className={`${notionStyles.rowActionBtn} ${notionStyles.rowDragHandle}`}
                            title="Arrastrar"
                            draggable
                            onDragStart={() => handleRowDragStart(sourceRowIdx)}
                            onDragEnd={handleRowDragEnd}
                          >
                            <FiMoreVertical size={12} />
                          </span>
                          <button
                            type="button"
                            className={row.id && selectedRows.includes(row.id) ? notionStyles.rowSelectorBtnActive : notionStyles.rowSelectorBtn}
                            onClick={() => toggleRowSelection(row)}
                            aria-label="Seleccionar fila"
                          >
                            {row.id && selectedRows.includes(row.id) ? "✓" : ""}
                          </button>
                        </div>
                      </td>
                      {(() => {
                        let visibleColIdx = 0;
                        return baseColumns.map((column, colIdx) => {
                          if (column.hidden) return null;
                          const field = baseFieldMetas[colIdx];
                          if (!field) return null;
                          const currentVisibleColIdx = visibleColIdx;
                          visibleColIdx += 1;
                          return <React.Fragment key={`base-${colIdx}-${column.id || column.savedTitle || column.title}`}>{renderFieldEditor(sourceRowIdx, row, field, currentVisibleColIdx, notionStyles.baseColumnCell, displayIdx)}</React.Fragment>;
                        });
                      })()}
                      {(() => {
                        let visibleColIdx = visibleBaseColumns.length;
                        return customFieldMetas.map((field) => {
                          const column = customColumns[field.index];
                          if (!column || column.hidden) return null;
                          const currentVisibleColIdx = visibleColIdx;
                          visibleColIdx += 1;
                          return <React.Fragment key={`custom-${field.index}-${column.id || column.savedTitle || column.title}`}>{renderFieldEditor(sourceRowIdx, row, field, currentVisibleColIdx, notionStyles.emptyCustomCell, displayIdx)}</React.Fragment>;
                        });
                      })()}
                      <td className={notionStyles.addColumnCell}></td>
                    </tr>
                    );
                  })}
                  <tr className={notionStyles.addRowLine}>
                    <td colSpan={(visibleColumnCount || 1) + 2}>
                      <button type="button" className={notionStyles.addRowBtn} onClick={handleAddRow}>
                        <FiPlus /> Añadir fila
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
              </div>
            </div>
          </div>
        </div>
        </PageContent>
      </main>

      {deleteConfirm && (
        <div className={tabChrome.confirmOverlay} onClick={() => setDeleteConfirm(null)}>
          <div className={tabChrome.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={tabChrome.confirmIcon}><FiTrash2 /></div>
            <h3>Eliminar tabla</h3>
            <p>¿Estás seguro de eliminar <strong>&ldquo;{deleteConfirm.title}&rdquo;</strong>? Se moverá a la papelera por 15 días.</p>
            <div className={tabChrome.confirmActions}>
              <button type="button" className={tabChrome.confirmCancel} onClick={() => setDeleteConfirm(null)}>Cancelar</button>
              <button type="button" className={tabChrome.confirmDelete} onClick={confirmDeleteNotionTab}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {permanentDeleteConfirm && (
        <div className={tabChrome.confirmOverlay} onClick={() => setPermanentDeleteConfirm(null)}>
          <div className={tabChrome.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={tabChrome.confirmIconDanger}><FiTrash2 /></div>
            <h3>Eliminar permanentemente</h3>
            <p>¿Estás seguro de eliminar <strong>&ldquo;{permanentDeleteConfirm.title}&rdquo;</strong> de forma permanente? Esta acción no se puede deshacer.</p>
            <div className={tabChrome.confirmActions}>
              <button type="button" className={tabChrome.confirmCancel} onClick={() => setPermanentDeleteConfirm(null)}>Cancelar</button>
              <button type="button" className={tabChrome.confirmDeletePermanent} onClick={confirmPermanentDelete}>Eliminar permanentemente</button>
            </div>
          </div>
        </div>
      )}

      {showHistoryPanel && (
        <NotionHistoryPanel
          open={showHistoryPanel}
          onClose={() => setShowHistoryPanel(false)}
          activeTabId={activeTabId}
          tabs={notionTabs.map((tab) => ({ id: tab.id, title: tab.title }))}
          tabTitles={historyData?.tabTitles ?? {}}
          revisions={historyData?.revisions ?? []}
          audit={historyData?.audit ?? []}
          loading={historyLoading}
          onRefresh={(tabId) => { void refreshHistory(tabId || activeTabId); }}
          onCreateManual={handleCreateManualHistoryRevision}
          onApply={handleApplyHistoryRevision}
          onRestoreLatest={handleRestoreLatestHistory}
          onNotify={showSnackbar}
        />
      )}

      <SnackbarStack items={snackbars} />

      {showTrashPanel && (
        <div className={tabChrome.trashOverlay} onClick={() => setShowTrashPanel(false)}>
          <div className={tabChrome.trashPanel} onClick={(e) => e.stopPropagation()}>
            <div className={tabChrome.trashHeader}>
              <FiTrash2 />
              <h3>Papelera</h3>
              <span className={tabChrome.trashSubtitle}>Los elementos se eliminan automáticamente después de 15 días</span>
              <button type="button" className={tabChrome.trashCloseBtn} onClick={() => setShowTrashPanel(false)}>×</button>
            </div>
            <div className={tabChrome.trashList}>
              {notionTrash.length === 0 ? (
                <div className={tabChrome.trashEmpty}>
                  <FiTrash2 />
                  <p>La papelera está vacía</p>
                </div>
              ) : (
                notionTrash.map((tab) => {
                  const trashedDate = tab.trashedAt ? new Date(tab.trashedAt) : null;
                  const daysLeft = trashedDate ? Math.max(0, 15 - Math.floor((Date.now() - trashedDate.getTime()) / (1000 * 60 * 60 * 24))) : 15;
                  return (
                    <div key={tab.id} className={tabChrome.trashItem}>
                      <div className={tabChrome.trashItemInfo}>
                        <FiLayers />
                        <div>
                          <span className={tabChrome.trashItemTitle}>{tab.title}</span>
                          <span className={tabChrome.trashItemMeta}>{daysLeft} días restantes</span>
                        </div>
                      </div>
                      <div className={tabChrome.trashItemActions}>
                        <button type="button" onClick={() => handleRestoreTab(tab.id)} title="Restaurar">
                          <FiArrowLeft /> Restaurar
                        </button>
                        <button type="button" className={tabChrome.trashDeleteBtn} onClick={() => handlePermanentDelete(tab.id)} title="Eliminar permanentemente">
                          <FiTrash2 />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Panel de gestión Personas ↔ Áreas (solo admin/dev) */}
      {showAreasPanel && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.35)" }}
          onClick={() => setShowAreasPanel(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
              padding: "24px 28px",
              minWidth: 360,
              maxWidth: 480,
              maxHeight: "80vh",
              overflowY: "auto",
              zIndex: 9999,
              width: "90vw",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Personas y Áreas</h3>
              <button
                onClick={() => setShowAreasPanel(false)}
                style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
              >×</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-dim)" }}>
              Asigna áreas del menú (Administrativo, TI, Calidad, etc.) a cada persona. Al seleccionar a alguien en Personas, su área se asignará automáticamente.
            </p>

            {systemUsers.length === 0 && (
              <p style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
                No hay usuarios registrados.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {systemUsers.map(u => {
                const isEditing = areasEditUser === u.id;
                return (
                  <div
                    key={u.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1px solid ${isEditing ? "var(--primary)" : "var(--border)"}`,
                      background: isEditing ? "color-mix(in srgb, var(--primary) 6%, var(--card))" : "var(--bg)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isEditing ? 10 : (u.areas.length > 0 ? 8 : 0) }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{u.displayName}</span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-dim)", background: "var(--border)", borderRadius: 6, padding: "1px 7px" }}>{u.username}</span>
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => setAreasEditUser(u.id)}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 10px", color: "var(--text-dim)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                        >
                          Editar
                        </button>
                      )}
                    </div>

                    {/* Chips de áreas */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: isEditing ? 10 : 0 }}>
                      {sanitizeDepartmentAreas(u.areas).map(area => (
                        <span
                          key={area}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600 }}
                        >
                          {area}
                          {isEditing && (
                            <button
                              onClick={() => saveUserAreas(u.id, u.areas.filter(a => a !== area))}
                              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 14 }}
                            >×</button>
                          )}
                        </span>
                      ))}
                      {sanitizeDepartmentAreas(u.areas).length === 0 && !isEditing && (
                        <span style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>Sin áreas asignadas</span>
                      )}
                    </div>

                    {/* Selector fijo de áreas del menú */}
                    {isEditing && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }}>
                          {DEPARTMENT_AREAS.map((area) => {
                            const checked = sanitizeDepartmentAreas(u.areas).includes(area);
                            return (
                              <label key={area} style={{ display: "flex", alignItems: "center", gap: 8, cursor: areasLoading ? "wait" : "pointer", fontSize: 13, color: "var(--text)" }}>
                                <input
                                  type="checkbox"
                                  disabled={areasLoading}
                                  checked={checked}
                                  onChange={() => {
                                    const current = sanitizeDepartmentAreas(u.areas);
                                    const next = checked ? current.filter((a) => a !== area) : [...current, area];
                                    void saveUserAreas(u.id, next);
                                  }}
                                />
                                {area}
                              </label>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setAreasEditUser(null)}
                          style={{ alignSelf: "flex-end", padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
                        >Listo</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Popup selector de área cuando una persona tiene múltiples departamentos */}
      {areaPicker && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "transparent" }}
          onClick={() => setAreaPicker(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              padding: "20px 24px",
              minWidth: 260,
              maxWidth: 340,
              zIndex: 10000,
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: 13, color: "var(--text-dim)" }}>
              ¿En qué área participa
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {areaPicker.personName}?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {areaPicker.options.map(area => (
                <button
                  key={area}
                  onClick={() => {
                    updateTaskField(areaPicker.rowIdx, areaPicker.relacionField, area);
                    setAreaPicker(null);
                  }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 14,
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--primary)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "var(--bg)")}
                >
                  {area}
                </button>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              Clic fuera para cancelar
            </p>
          </div>
        </div>
      )}

      {/* Modal: Compartidos conmigo */}
      {showSharedWithMe && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowSharedWithMe(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 30px", width: 420, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <FiUserCheck size={20} color="var(--accent)" />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Compartidos conmigo</h3>
            </div>
            {sharedWithMeLoading ? (
              <p style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Cargando…</p>
            ) : sharedWithMeList.length === 0 ? (
              <p style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Nadie ha compartido una tabla contigo todavía.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sharedWithMeList.map(share => {
                  const isOpen = notionTabs.some(t => t.id === share.tab_id);
                  return (
                    <div key={share.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{share.tab_title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>Compartido por {share.owner_name ?? share.owner_id}</div>
                      </div>
                      {isOpen ? (
                        <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>Abierta</span>
                      ) : (
                        <button
                          type="button"
                          disabled={reopenLoading === share.id}
                          onClick={() => handleReopenTab(share.id)}
                          style={{ padding: "5px 14px", borderRadius: 8, background: "var(--accent)", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: reopenLoading === share.id ? 0.6 : 1 }}
                        >
                          {reopenLoading === share.id ? "…" : "Abrir"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowSharedWithMe(false)}
              style={{ marginTop: 20, width: "100%", padding: "9px 0", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 13, cursor: "pointer" }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal: Compartir Notion */}
      {showShareModal && shareTargetTab && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowShareModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 16, padding: "28px 30px", width: 400, maxWidth: "90vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <FiShare2 size={20} color="var(--accent)" />
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                Compartir &quot;{shareTargetTab.title}&quot;
              </h3>
            </div>

            {shareSuccess ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--accent)", fontWeight: 700, fontSize: 15 }}>
                ✓ Invitación enviada correctamente
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-dim)" }}>
                  Selecciona el usuario con quien compartir:
                </p>
                <div
                  className={notionStyles.modalScrollList}
                  style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, marginBottom: 16 }}
                  onWheel={(event) => {
                    event.stopPropagation();
                    event.currentTarget.scrollTop += event.deltaY;
                  }}
                >
                  {systemUsers.filter(u => u.id !== auth.user?.id).map(u => {
                    const alreadyShared = sharesForShareModal.some(s => s.shared_with_id === u.id && s.status !== "declined");
                    return (
                      <button
                        key={u.id}
                        onClick={() => setShareSelectedUser(alreadyShared ? null : { id: u.id, displayName: u.displayName })}
                        disabled={alreadyShared}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", borderRadius: 10,
                          border: shareSelectedUser?.id === u.id ? "2px solid var(--accent)" : "1px solid var(--border)",
                          background: alreadyShared ? "var(--bg)" : shareSelectedUser?.id === u.id ? "rgba(16,180,130,0.08)" : "none",
                          cursor: alreadyShared ? "not-allowed" : "pointer",
                          opacity: alreadyShared ? 0.6 : 1,
                          textAlign: "left",
                        }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                          {u.displayName[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{u.displayName}</div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>@{u.username}</div>
                        </div>
                        {alreadyShared && (
                          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: "var(--accent)" }}>Ya compartido</span>
                        )}
                      </button>
                    );
                  })}
                  {systemUsers.filter(u => u.id !== auth.user?.id).length === 0 && (
                    <p style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>No hay otros usuarios disponibles.</p>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowShareModal(false)}
                    style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "none", cursor: "pointer", fontSize: 13, color: "var(--text-dim)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleShareTab}
                    disabled={!shareSelectedUser || shareLoading}
                    style={{
                      padding: "8px 20px", borderRadius: 8, border: "none",
                      background: shareSelectedUser ? "var(--accent)" : "var(--border)",
                      color: shareSelectedUser ? "#fff" : "var(--text-dim)",
                      cursor: shareSelectedUser ? "pointer" : "not-allowed",
                      fontWeight: 700, fontSize: 13,
                    }}
                  >
                    {shareLoading ? "Enviando..." : "Enviar invitación"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
