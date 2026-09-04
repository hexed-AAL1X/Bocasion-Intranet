"use client";

import { useState, useEffect, useMemo, useCallback, useRef, Fragment, type Dispatch, type SetStateAction } from "react";
import {
  FiActivity, FiAlertTriangle, FiCalendar, FiTool,
  FiTrendingDown, FiList, FiBarChart2, FiCheckCircle,
  FiXCircle, FiAlertCircle, FiClock, FiEdit2, FiX,
  FiDollarSign, FiPackage, FiArrowRight, FiUsers,
  FiChevronDown, FiChevronRight, FiPlus,
} from "react-icons/fi";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell,
} from "recharts";
import { poppins } from "@/fonts";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useCalendarToggle } from "@/contexts/CalendarToggleContext";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { useAuthSession } from "@/components/AuthGate";
import { canEditProgramaAnual } from "@/lib/roles";
import { resolveProgramaAnualApi } from "@/utils/api";

const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"] as const;
const MES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Set","Oct","Nov","Dic"] as const;
const MES_LARGO = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Setiembre","Octubre","Noviembre","Diciembre"] as const;
type Month = typeof MONTHS[number];

interface ActividadMeta {
  equipoAsociado?: string;
  fechaCompra?: string;
  costoCompra?: number;
  vidaUtilAnios?: number;
  proveedorEquipo?: string;
  notasCompra?: string;
}

interface Actividad {
  id: string;
  actividad: string;
  frecuencia: string;
  responsable: string;
  presupuesto: string | null;
  programa: string;
  programaLabel: string;
  planeado: Record<Month, boolean>;
  realizado: Record<Month, boolean>;
  totalPlaneado: number;
  totalRealizado: number;
  cumplimiento: number | null;
  alertas: string[];
  meta: ActividadMeta;
  vidaAlcanzada: number | null;
  depreciacionPct: number | null;
  valorResidual: number | null;
  aniosRestantes: number | null;
}

const ALERT_META: Record<string, { label: string; level: "critico"|"alta"|"media"|"baja" }> = {
  pendiente_mes_actual:     { label: "Pendiente este mes",          level: "alta"    },
  no_ejecutado_mes_anterior:{ label: "No ejecutado mes anterior",   level: "alta"    },
  programado_proximo_mes:   { label: "Programado próximo mes",      level: "baja"    },
  bajo_cumplimiento:        { label: "Bajo cumplimiento (<50%)",    level: "media"   },
  sin_ejecucion:            { label: "Sin ninguna ejecución",       level: "media"   },
  equipo_vida_vencida:      { label: "Equipo: vida útil vencida",   level: "critico" },
  equipo_vida_critica:      { label: "Equipo: vida útil crítica",   level: "alta"    },
  equipo_vida_proxima:      { label: "Equipo: vida útil próxima",   level: "media"   },
};

const LEVEL_ORDER = ["critico","alta","media","baja"] as const;
type AlertLevel = typeof LEVEL_ORDER[number];

type AlertGroup = {
  act: Actividad;
  items: { alerta: string; level: AlertLevel; label: string }[];
  topLevel: AlertLevel;
  hasPendienteMes: boolean;
};

function buildAlertGroups(actividades: Actividad[]): AlertGroup[] {
  const map = new Map<string, AlertGroup>();
  actividades.forEach(act => {
    act.alertas.forEach(alertKey => {
      const meta = ALERT_META[alertKey];
      if (!meta) return;
      let g = map.get(act.id);
      if (!g) {
        g = { act, items: [], topLevel: meta.level, hasPendienteMes: false };
        map.set(act.id, g);
      }
      g.items.push({ alerta: alertKey, level: meta.level, label: meta.label });
      if (LEVEL_ORDER.indexOf(meta.level) < LEVEL_ORDER.indexOf(g.topLevel)) {
        g.topLevel = meta.level;
      }
      if (alertKey === "pendiente_mes_actual") g.hasPendienteMes = true;
    });
  });
  return Array.from(map.values())
    .map(g => ({
      ...g,
      items: [...g.items].sort((a, b) => {
        const ld = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
        if (ld !== 0) return ld;
        if (a.alerta === "pendiente_mes_actual") return -1;
        if (b.alerta === "pendiente_mes_actual") return 1;
        return a.label.localeCompare(b.label, "es");
      }),
    }))
    .sort((a, b) => {
      const ld = LEVEL_ORDER.indexOf(a.topLevel) - LEVEL_ORDER.indexOf(b.topLevel);
      if (ld !== 0) return ld;
      if (a.hasPendienteMes !== b.hasPendienteMes) return a.hasPendienteMes ? -1 : 1;
      return a.act.actividad.localeCompare(b.act.actividad, "es");
    });
}

const LEVEL_LABEL: Record<AlertLevel, string> = {
  critico: "Crítico",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const ALERT_LEVEL_COLOR: Record<AlertLevel, string> = {
  critico: "#e53935",
  alta: "#f57c00",
  media: "#f4b000",
  baja: "#1f7aec",
};

const PIE_COLORS = ["#0ea5e9","#1f7aec","#f4b000","#e53935","#7c3aed","#06b6d4","#f97316"];
const FREQ_COLORS: Record<string,string> = {
  "Mensual":"#1f7aec","Bimensual":"#06b6d4","Trimestral":"#0ea5e9",
  "Semestral":"#f4b000","Anual":"#e53935","cada 2 años":"#7c3aed",
};
const PROG_COLORS: Record<string,string> = {
  "Objetivo SSO":"#e53935","Capacitaciones SSO":"#f57c00",
  "Actividades SSO":"#1f7aec","Calidad e Infraestructura":"#0ea5e9",
};

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"});
}
function fmtCurrency(v?: number) {
  if (!v) return "—";
  return `S/. ${v.toLocaleString("es-PE",{minimumFractionDigits:0})}`;
}

function ProgBar({ pct, cls }: { pct: number; cls: "progFillGreen" | "progFillYellow" | "progFillRed" | "progFillBlue" }) {
  return (
    <div className={styles.progBar}>
      <div className={`${styles.progFill} ${styles[cls]}`} style={{ width:`${Math.min(100,pct)}%` }} />
    </div>
  );
}

const PAGE_SIZE = 25;

/* ── Drawer edición (admin/dev) ── */
const PROGRAMA_DEFAULTS = [
  { key: "OBJETIVO1", label: "Objetivo SSO" },
  { key: "OBJETIVO 2", label: "Capacitaciones SSO" },
  { key: "OBJETIVOS 3", label: "Actividades SSO" },
  { key: "CALIDAD E INFRAESTRUCTURA", label: "Calidad e Infraestructura" },
] as const;

const CUSTOM_PROGRAMA = "__custom__";

type EditDrawerState =
  | { kind: "create" }
  | { kind: "edit"; act: Actividad };

function emptyMonths(): Record<Month, boolean> {
  return Object.fromEntries(MONTHS.map(m => [m, false])) as Record<Month, boolean>;
}

function ActividadEditDrawer({
  state,
  programaOptions,
  onClose,
  onSaved,
}: {
  state: EditDrawerState;
  programaOptions: { key: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = state.kind === "create";
  const act = state.kind === "edit" ? state.act : null;

  const findProgramaKey = (a: Actividad | null) => {
    if (!a) return programaOptions[0]?.key ?? CUSTOM_PROGRAMA;
    const found = programaOptions.find(p => p.key === a.programa || p.label === a.programaLabel);
    return found?.key ?? CUSTOM_PROGRAMA;
  };

  const [nombre, setNombre] = useState(act?.actividad ?? "");
  const [programaKey, setProgramaKey] = useState(() => findProgramaKey(act));
  const [customProgramaLabel, setCustomProgramaLabel] = useState(() => {
    if (!act) return "";
    return findProgramaKey(act) === CUSTOM_PROGRAMA ? act.programaLabel : "";
  });
  const [customProgramaKey, setCustomProgramaKey] = useState(() => {
    if (!act) return "";
    return findProgramaKey(act) === CUSTOM_PROGRAMA ? act.programa : "";
  });
  const [metaForm, setMetaForm] = useState<ActividadMeta>({ ...(act?.meta ?? {}) });
  const [planeado, setPlaneado] = useState<Record<Month, boolean>>(act ? { ...act.planeado } : emptyMonths());
  const [realizado, setRealizado] = useState<Record<Month, boolean>>(act ? { ...act.realizado } : emptyMonths());
  const [responsable, setResponsable] = useState(act?.responsable ?? "");
  const [frecuencia, setFrecuencia] = useState(act?.frecuencia ?? "");
  const [presupuesto, setPresupuesto] = useState(act?.presupuesto ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialSnapshot = useRef(JSON.stringify({
    nombre: act?.actividad ?? "",
    programaKey: findProgramaKey(act),
    customProgramaLabel: act && findProgramaKey(act) === CUSTOM_PROGRAMA ? act.programaLabel : "",
    customProgramaKey: act && findProgramaKey(act) === CUSTOM_PROGRAMA ? act.programa : "",
    meta: act?.meta ?? {},
    planeado: act?.planeado ?? emptyMonths(),
    realizado: act?.realizado ?? emptyMonths(),
    responsable: act?.responsable ?? "",
    frecuencia: act?.frecuencia ?? "",
    presupuesto: act?.presupuesto ?? "",
  }));

  const dirty = JSON.stringify({
    nombre, programaKey, customProgramaLabel, customProgramaKey,
    meta: metaForm, planeado, realizado, responsable, frecuencia, presupuesto,
  }) !== initialSnapshot.current;

  const resolvePrograma = () => {
    if (programaKey === CUSTOM_PROGRAMA) {
      const label = customProgramaLabel.trim();
      const key = customProgramaKey.trim() || label.toUpperCase();
      return { programa: key, programaLabel: label || key };
    }
    const opt = programaOptions.find(p => p.key === programaKey);
    return { programa: opt?.key ?? programaKey, programaLabel: opt?.label ?? programaKey };
  };

  const setMeta = (k: keyof ActividadMeta, v: string | number) =>
    setMetaForm(f => ({ ...f, [k]: v }));

  const toggleMonth = (kind: "planeado" | "realizado", month: Month) => {
    const setter = kind === "planeado" ? setPlaneado : setRealizado;
    setter(prev => ({ ...prev, [month]: !prev[month] }));
  };

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCancel]);

  const apiFetch = (method: string, body: unknown) =>
    fetch(resolveProgramaAnualApi(), {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

  const handleSave = async () => {
    const { programa, programaLabel } = resolvePrograma();
    if (!nombre.trim()) {
      setError("El nombre de la actividad es obligatorio");
      return;
    }
    if (!programaLabel.trim()) {
      setError("Selecciona o define un programa");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isCreate) {
        const res = await apiFetch("POST", {
          actividad: nombre.trim(),
          programa,
          programaLabel,
          frecuencia,
          responsable,
          presupuesto: presupuesto.trim() || null,
          planeado,
          realizado,
          meta: metaForm,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : `Error ${res.status}`);
        }
      } else if (act) {
        const hasMeta = JSON.stringify(metaForm) !== JSON.stringify(act.meta ?? {});
        if (hasMeta) {
          const res = await apiFetch("PUT", { id: act.id, meta: metaForm });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(typeof data.error === "string" ? data.error : `Error ${res.status}`);
          }
        }
        const res = await apiFetch("PATCH", {
          id: act.id,
          patch: {
            actividad: nombre.trim(),
            programa,
            programaLabel,
            planeado,
            realizado,
            responsable,
            frecuencia,
            presupuesto: presupuesto.trim() || null,
          },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : `Error ${res.status}`);
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (scope: "meta" | "override" | "actividad") => {
    if (!act) return;
    const msg = scope === "meta"
      ? "¿Eliminar todos los datos de equipo/compra de esta actividad?"
      : scope === "override"
        ? "¿Revertir planificación y ejecución editadas? Volverá a los datos originales del Excel."
        : "¿Eliminar esta actividad por completo? Esta acción no se puede deshacer.";
    if (!window.confirm(msg)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("DELETE", { id: act.id, scope });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : `Error ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  };

  const previewTotals = useMemo(() => {
    const totalPlaneado = MONTHS.filter(m => planeado[m]).length;
    const totalRealizado = MONTHS.filter(m => realizado[m]).length;
    const cumplimiento = totalPlaneado > 0 ? Math.round((totalRealizado / totalPlaneado) * 100) : null;
    return { totalPlaneado, totalRealizado, cumplimiento };
  }, [planeado, realizado]);

  return (
    <div className={styles.drawer}>
      <div className={styles.drawerPanel}>
        <div className={styles.drawerHead}>
          <div>
            <h3 className={styles.drawerTitle}>{isCreate ? "Nueva actividad" : "Editar actividad"}</h3>
            <p className={styles.drawerSub}>Administrador / desarrollador</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={handleCancel} title="Cancelar (Esc)"><FiX /></button>
        </div>
        <div className={styles.drawerBody}>
          {error && <p className={styles.drawerError} role="alert">{error}</p>}

          <div className={styles.drawerSection}>Identificación</div>
          <div className={styles.metaField}>
            <label className={styles.metaLabel}>Nombre de la actividad</label>
            <input className={styles.metaInput} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Calibración de equipos" />
          </div>
          <div className={styles.metaField}>
            <label className={styles.metaLabel}>Programa</label>
            <select className={styles.metaInput} value={programaKey} onChange={e => setProgramaKey(e.target.value)}>
              {programaOptions.map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value={CUSTOM_PROGRAMA}>+ Nuevo programa…</option>
            </select>
          </div>
          {programaKey === CUSTOM_PROGRAMA && (
            <div className={styles.metaRow}>
              <div className={styles.metaField}>
                <label className={styles.metaLabel}>Nombre del programa</label>
                <input className={styles.metaInput} value={customProgramaLabel} onChange={e => setCustomProgramaLabel(e.target.value)} placeholder="Ej: Proyectos especiales" />
              </div>
              <div className={styles.metaField}>
                <label className={styles.metaLabel}>Código (opcional)</label>
                <input className={styles.metaInput} value={customProgramaKey} onChange={e => setCustomProgramaKey(e.target.value)} placeholder="Se genera del nombre" />
              </div>
            </div>
          )}

          <div className={styles.drawerSection}>Datos generales</div>
          <div className={styles.metaRow}>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Responsable</label>
              <input className={styles.metaInput} value={responsable} onChange={e => setResponsable(e.target.value)} />
            </div>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Frecuencia</label>
              <input className={styles.metaInput} value={frecuencia} onChange={e => setFrecuencia(e.target.value)} />
            </div>
          </div>
          <div className={styles.metaField}>
            <label className={styles.metaLabel}>Presupuesto</label>
            <input className={styles.metaInput} value={presupuesto} onChange={e => setPresupuesto(e.target.value)} placeholder="Opcional" />
          </div>

          <div className={styles.drawerSection}>
            Planificación mensual
            <span className={styles.drawerSectionMeta}>
              P {previewTotals.totalPlaneado} · R {previewTotals.totalRealizado}
              {previewTotals.cumplimiento !== null && ` · ${previewTotals.cumplimiento}%`}
            </span>
          </div>
          <div className={styles.editMonthGrid}>
            <div className={styles.editMonthCorner} />
            {MES_CORTO.map(lbl => (
              <div key={lbl} className={styles.editMonthLbl}>{lbl}</div>
            ))}
            <div className={styles.editMonthRowLbl}>P</div>
            {MONTHS.map(m => (
              <label key={`p-${m}`} className={styles.editMonthCell}>
                <input type="checkbox" checked={!!planeado[m]} onChange={() => toggleMonth("planeado", m)} />
              </label>
            ))}
            <div className={styles.editMonthRowLbl}>R</div>
            {MONTHS.map(m => (
              <label key={`r-${m}`} className={styles.editMonthCell}>
                <input type="checkbox" checked={!!realizado[m]} onChange={() => toggleMonth("realizado", m)} />
              </label>
            ))}
          </div>

          <div className={styles.drawerSection}>Equipo asociado</div>
          <div className={styles.metaRow}>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Nombre del equipo</label>
              <input className={styles.metaInput} value={metaForm.equipoAsociado ?? ""} onChange={e => setMeta("equipoAsociado", e.target.value)} placeholder="Ej: Termómetro Patrón" />
            </div>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Proveedor</label>
              <input className={styles.metaInput} value={metaForm.proveedorEquipo ?? ""} onChange={e => setMeta("proveedorEquipo", e.target.value)} />
            </div>
          </div>
          <div className={styles.metaRow}>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Fecha de compra</label>
              <input type="date" className={styles.metaInput} value={metaForm.fechaCompra ? metaForm.fechaCompra.slice(0, 10) : ""} onChange={e => setMeta("fechaCompra", e.target.value ? new Date(e.target.value).toISOString() : "")} />
            </div>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Costo (S/.)</label>
              <input type="number" className={styles.metaInput} value={metaForm.costoCompra ?? ""} onChange={e => setMeta("costoCompra", parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className={styles.metaRow}>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Vida útil (años)</label>
              <input type="number" className={styles.metaInput} value={metaForm.vidaUtilAnios ?? ""} onChange={e => setMeta("vidaUtilAnios", parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className={styles.metaField}>
              <label className={styles.metaLabel}>Notas</label>
              <input className={styles.metaInput} value={metaForm.notasCompra ?? ""} onChange={e => setMeta("notasCompra", e.target.value)} />
            </div>
          </div>
        </div>
        <div className={styles.drawerFooter}>
          <div className={styles.drawerFooterLeft}>
            {!isCreate && (
              <>
                <button type="button" className={styles.deleteBtn} disabled={saving} onClick={() => handleDelete("override")}>
                  Revertir plan
                </button>
                <button type="button" className={styles.deleteBtn} disabled={saving} onClick={() => handleDelete("meta")}>
                  Borrar equipo
                </button>
                <button type="button" className={`${styles.deleteBtn} ${styles.deleteBtnDanger}`} disabled={saving} onClick={() => handleDelete("actividad")}>
                  Eliminar actividad
                </button>
              </>
            )}
          </div>
          <div className={styles.drawerFooterRight}>
            <button type="button" className={styles.cancelBtn} onClick={handleCancel} disabled={saving}>Cancelar</button>
            <button type="button" className={styles.saveBtn} disabled={saving || (!isCreate && !dirty)} onClick={handleSave}>
              {saving ? "Guardando…" : isCreate ? "Crear actividad" : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ActRowHelpers = {
  getNextMaint: (act: Actividad) => Month | null;
  onToggleExpand: (id: string) => void;
  onEdit: (act: Actividad) => void;
  canEdit: boolean;
};

function ActividadRows({
  acts,
  showPrograma,
  actViewFull,
  expandedActId,
  highlightActId,
  editingActId,
  helpers,
}: {
  acts: Actividad[];
  showPrograma: boolean;
  actViewFull: boolean;
  expandedActId: string | null;
  highlightActId: string | null;
  editingActId: string | null;
  helpers: ActRowHelpers;
}) {
  const colSpan = (actViewFull ? 14 : 10) - (showPrograma ? 0 : 1) - (helpers.canEdit ? 0 : 1);

  return (
    <>
      {acts.map(act => {
        const isExpanded = expandedActId === act.id;
        const isHighlight = highlightActId === act.id;
        const isEditing = editingActId === act.id;
        const nm = helpers.getNextMaint(act);
        return (
          <Fragment key={act.id}>
            <tr
              data-act-id={act.id}
              className={`${isHighlight ? styles.rowHighlight : ""} ${isExpanded && !isEditing ? styles.rowExpanded : ""} ${isEditing ? styles.rowEditing : ""}`}
            >
              <td className={styles.actNameCell} title={act.actividad}>
                <span className={styles.actNameText}>{act.actividad}</span>
              </td>
              {showPrograma && (
                <td>
                  <span className={styles.badge} style={{ background: `${PROG_COLORS[act.programaLabel] ?? PIE_COLORS[0]}22`, color: PROG_COLORS[act.programaLabel] ?? PIE_COLORS[0], borderColor: `${PROG_COLORS[act.programaLabel] ?? PIE_COLORS[0]}44` }}>
                    {act.programaLabel}
                  </span>
                </td>
              )}
              <td>
                <span className={styles.badge} style={{ background: `${FREQ_COLORS[act.frecuencia] ?? PIE_COLORS[0]}18`, color: FREQ_COLORS[act.frecuencia] ?? PIE_COLORS[0] }}>
                  {act.frecuencia || "—"}
                </span>
              </td>
              <td className={styles.respCell}>{act.responsable || "—"}</td>
              {actViewFull && <td>{act.presupuesto || "—"}</td>}
              {actViewFull ? (
                <>
                  <td className={styles.numCell}>{act.totalPlaneado}</td>
                  <td className={styles.numCell} style={{ color: "#0ea5e9" }}>{act.totalRealizado}</td>
                </>
              ) : (
                <td className={styles.prCell}>
                  <span title="Planeado">{act.totalPlaneado}</span>
                  <span className={styles.prSep}>/</span>
                  <span className={styles.prReal} title="Realizado">{act.totalRealizado}</span>
                </td>
              )}
              <td className={styles.cumplCell}>
                {act.cumplimiento !== null ? (
                  <div className={styles.cumplWrap}>
                    <span className={styles.cumplPct} style={{ color: act.cumplimiento >= 100 ? "#0ea5e9" : act.cumplimiento >= 50 ? "#f57c00" : "#e53935" }}>{act.cumplimiento}%</span>
                    <ProgBar pct={act.cumplimiento} cls={act.cumplimiento >= 100 ? "progFillGreen" : act.cumplimiento >= 50 ? "progFillYellow" : "progFillRed"} />
                  </div>
                ) : "—"}
              </td>
              {actViewFull && (
                <>
                  <td className={styles.dimCell}>{act.meta.equipoAsociado ? act.meta.equipoAsociado : <span className={styles.muted}>Sin equipo</span>}</td>
                  <td className={styles.dimCell}>{act.meta.fechaCompra ? fmtDate(act.meta.fechaCompra) : <span className={styles.muted}>—</span>}</td>
                  <td>{nm ? <span className={styles.badge} style={{ background: "rgba(31,122,236,.12)", color: "#1f7aec", borderColor: "rgba(31,122,236,.25)" }}><FiCalendar size={9} /> {nm}</span> : <span className={styles.muted}>—</span>}</td>
                  <td className={styles.cumplCell}>
                    {act.depreciacionPct !== null ? (
                      <div className={styles.cumplWrap}>
                        <span className={styles.cumplPct} style={{ color: act.depreciacionPct >= 80 ? "#e53935" : act.depreciacionPct >= 50 ? "#f57c00" : "#0ea5e9" }}>{act.depreciacionPct}%</span>
                        <ProgBar pct={act.depreciacionPct} cls={act.depreciacionPct >= 80 ? "progFillRed" : act.depreciacionPct >= 50 ? "progFillYellow" : "progFillGreen"} />
                      </div>
                    ) : "—"}
                  </td>
                </>
              )}
              <td>
                {act.alertas.length > 0 ? (
                  <div className={styles.alertCell}>
                    <span className={`${styles.badge} ${styles[ALERT_META[act.alertas[0]]?.level ?? "baja"]}`}>
                      <FiAlertTriangle size={9} /> {ALERT_META[act.alertas[0]]?.label ?? act.alertas[0]}
                    </span>
                    {act.alertas.length > 1 && <span className={styles.alertMore}>+{act.alertas.length - 1}</span>}
                  </div>
                ) : (
                  <span className={`${styles.badge} ${styles.success}`}><FiCheckCircle size={9} /> OK</span>
                )}
              </td>
              {!actViewFull && (
                <td>
                  <button type="button" className={styles.expandBtn} onClick={() => helpers.onToggleExpand(act.id)} title={isExpanded ? "Ocultar detalle" : "Ver equipo y depreciación"} aria-expanded={isExpanded}>
                    {isExpanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                  </button>
                </td>
              )}
              {helpers.canEdit && (
                <td>
                  <button type="button" className={styles.editBtn} onClick={() => helpers.onEdit(act)} title="Editar actividad">
                    <FiEdit2 size={11} />
                  </button>
                </td>
              )}
            </tr>
            {!actViewFull && isExpanded && !isEditing && (
              <tr className={styles.actDetailRow}>
                <td colSpan={colSpan}>
                  <div className={styles.actDetailPanel}>
                    <div className={styles.actDetailGrid}>
                      <div><span className={styles.actDetailLbl}>Presupuesto</span><span>{act.presupuesto || "—"}</span></div>
                      <div><span className={styles.actDetailLbl}>Equipo</span><span>{act.meta.equipoAsociado || "Sin registrar"}</span></div>
                      <div><span className={styles.actDetailLbl}>F. compra</span><span>{act.meta.fechaCompra ? fmtDate(act.meta.fechaCompra) : "—"}</span></div>
                      <div><span className={styles.actDetailLbl}>Próx. mant.</span><span>{nm || "—"}</span></div>
                      <div><span className={styles.actDetailLbl}>Depreciación</span><span>{act.depreciacionPct !== null ? `${act.depreciacionPct}%` : "—"}</span></div>
                      <div><span className={styles.actDetailLbl}>Proveedor</span><span>{act.meta.proveedorEquipo || "—"}</span></div>
                    </div>
                    {helpers.canEdit && (
                    <button type="button" className={styles.actDetailEdit} onClick={() => helpers.onEdit(act)}>
                      <FiEdit2 size={11} /> Editar actividad
                    </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function ActividadTableHead({ actViewFull, showPrograma, canEdit }: { actViewFull: boolean; showPrograma: boolean; canEdit: boolean }) {
  return (
    <thead>
      <tr>
        <th>Actividad</th>
        {showPrograma && <th>Programa</th>}
        <th>Frecuencia</th>
        <th>Responsable</th>
        {actViewFull && <th>Presupuesto</th>}
        {actViewFull ? (
          <>
            <th title="Total planeado en el año">P</th>
            <th title="Total realizado en el año">R</th>
          </>
        ) : (
          <th title="Planeado / Realizado (año)">P / R</th>
        )}
        <th>Cumplimiento</th>
        {actViewFull && (
          <>
            <th>Equipo / Compra</th>
            <th>F. Compra</th>
            <th>Próx. Mant.</th>
            <th>Dep.</th>
          </>
        )}
        <th>Alertas</th>
        {!actViewFull && <th>Det.</th>}
        {canEdit && <th></th>}
      </tr>
    </thead>
  );
}

function countOverdueMonths(act: Actividad, currentMonthIdx: number): number {
  let n = 0;
  for (let mi = 0; mi < currentMonthIdx; mi++) {
    const m = MONTHS[mi] as Month;
    if (act.planeado[m] && !act.realizado[m]) n++;
  }
  return n;
}

type CronCellKind = "done" | "overdue" | "planned" | "extra";

function getCronCell(act: Actividad, mi: number, currentMonthIdx: number): { kind: CronCellKind; symbol: string } | null {
  const m = MONTHS[mi] as Month;
  const p = act.planeado[m];
  const r = act.realizado[m];
  const isPast = mi < currentMonthIdx;
  if (p && r) return { kind: "done", symbol: "\u2713" };
  if (p && isPast) return { kind: "overdue", symbol: "\u2717" };
  if (p) return { kind: "planned", symbol: "\u25CF" };
  if (r) return { kind: "extra", symbol: "\u2713" };
  return null;
}

function CronogramaPanel({
  acts,
  actividadesAll,
  totalCount,
  cronSearch,
  setCronSearch,
  cronFPrograma,
  setCronFPrograma,
  cronFResponsable,
  setCronFResponsable,
  cronProgOpen,
  setCronProgOpen,
  cronHighlightActId,
  programas,
  responsables,
  currentMonthIdx,
  onJumpAct,
  onGoActividades,
  onGoCalendario,
}: {
  acts: Actividad[];
  actividadesAll: Actividad[];
  totalCount: number;
  cronSearch: string;
  setCronSearch: (v: string) => void;
  cronFPrograma: string;
  setCronFPrograma: (v: string) => void;
  cronFResponsable: string;
  setCronFResponsable: (v: string) => void;
  cronProgOpen: Record<string, boolean>;
  setCronProgOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  cronHighlightActId: string | null;
  programas: string[];
  responsables: string[];
  currentMonthIdx: number;
  onJumpAct: (id: string) => void;
  onGoActividades: (actId: string) => void;
  onGoCalendario: (monthIdx: number, programaLabel: string) => void;
}) {
  const byProg = useMemo(() => {
    const map: Record<string, Actividad[]> = {};
    acts.forEach(a => {
      if (!map[a.programaLabel]) map[a.programaLabel] = [];
      map[a.programaLabel].push(a);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [acts]);

  const progChipLabels = programas.filter(p => p !== "Todos");
  const hasFilters = cronSearch.trim() || cronFPrograma !== "Todos" || cronFResponsable !== "Todos";

  const toggleProg = (prog: string) =>
    setCronProgOpen(prev => ({ ...prev, [prog]: !prev[prog] }));

  return (
    <div className={`${styles.section} ${styles.sectionFill}`}>
      <div className={styles.actHeader}>
        <div>
          <h2 className={styles.actTitle}>Programa anual</h2>
          <p className={styles.actSub}>
            {acts.length} de {totalCount} actividades
            {hasFilters ? " (filtradas)" : ""}
          </p>
        </div>
        <div className={styles.cronLegendInline}>
          <span><strong className={styles.cronSymDone}>✓</strong> Ejecutado</span>
          <span><strong className={styles.cronSymOverdue}>✗</strong> Vencido</span>
          <span><strong className={styles.cronSymPlanned}>●</strong> Pendiente</span>
        </div>
      </div>

      <div className={`${styles.tableWrapper} ${styles.tableWrapperFill}`}>
        <div className={styles.tableControls}>
          <input
            className={styles.tableSearch}
            placeholder="Buscar actividad, responsable…"
            value={cronSearch}
            onChange={e => setCronSearch(e.target.value)}
          />
          <select
            className={styles.actJumpSelect}
            value=""
            onChange={e => { if (e.target.value) onJumpAct(e.target.value); e.target.value = ""; }}
            title="Saltar a una actividad en el cronograma"
          >
            <option value="">Ir a actividad…</option>
            {acts.map(a => (
              <option key={a.id} value={a.id}>
                {(a.actividad.length > 50 ? `${a.actividad.slice(0, 50)}…` : a.actividad)} · {a.programaLabel}
              </option>
            ))}
          </select>
          <select className={styles.tableSelect} value={cronFPrograma} onChange={e => {
            const v = e.target.value;
            setCronFPrograma(v);
            if (v !== "Todos") setCronProgOpen(prev => ({ ...prev, [v]: true }));
          }}>
            {programas.map(p => <option key={p}>{p}</option>)}
          </select>
          <select className={styles.tableSelect} value={cronFResponsable} onChange={e => setCronFResponsable(e.target.value)}>
            {responsables.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        <div className={styles.actProgNav}>
          <div className={styles.actProgChips}>
            {progChipLabels.map(prog => {
              const count = actividadesAll.filter(a => a.programaLabel === prog).length;
              const isActive = cronFPrograma === prog;
              const isOpen = cronProgOpen[prog];
              const color = PROG_COLORS[prog] ?? PIE_COLORS[0];
              return (
                <button
                  key={prog}
                  type="button"
                  className={`${styles.actProgChip} ${isActive || isOpen ? styles.actProgChipActive : ""}`}
                  style={{
                    borderColor: isActive || isOpen ? color : undefined,
                    color: isActive || isOpen ? color : undefined,
                    background: isActive || isOpen ? `${color}14` : undefined,
                  }}
                  onClick={() => {
                    if (isActive) {
                      setCronFPrograma("Todos");
                    } else {
                      setCronFPrograma(prog);
                      setCronProgOpen(prev => ({ ...prev, [prog]: true }));
                    }
                  }}
                >
                  {prog} <span className={styles.actProgChipCount}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.actProgBulk}>
            <button type="button" className={styles.actProgBulkBtn} onClick={() => {
              const next: Record<string, boolean> = {};
              byProg.forEach(([p]) => { next[p] = true; });
              setCronProgOpen(next);
            }}>Expandir todo</button>
            <span className={styles.actProgBulkSep}>·</span>
            <button type="button" className={styles.actProgBulkBtn} onClick={() => setCronProgOpen({})}>Colapsar todo</button>
          </div>
        </div>

        <div className={`${styles.cronScroll} ${styles.cronScrollTall}`} data-lenis-prevent>
          {byProg.length === 0 ? (
            <div className={styles.empty}>No hay actividades con los filtros actuales.</div>
          ) : (
            <div className={styles.cronInner}>
              <div className={styles.cronRuler}>
                <div className={`${styles.cronActColHead} ${styles.cronStickyCorner}`}>Actividad</div>
                {MES_CORTO.map((label, mi) => (
                  <div
                    key={label}
                    className={`${styles.cronMonthHead} ${mi === currentMonthIdx ? styles.cronMonthCurr : ""}`}
                    title={MES_LARGO[mi]}
                  >
                    {mi === currentMonthIdx && <span className={styles.cronMonthBadge}>HOY</span>}
                    {label}
                  </div>
                ))}
              </div>

              {byProg.map(([prog, progActs]) => {
                const isOpen = cronProgOpen[prog] ?? false;
                const progColor = PROG_COLORS[prog] ?? PIE_COLORS[0];
                const progCumpl = Math.round(progActs.reduce((s, a) => s + (a.cumplimiento ?? 0), 0) / progActs.length);
                const progDone = progActs.filter(a => (a.cumplimiento ?? 0) >= 100).length;
                const progOverdue = progActs.reduce((s, a) => s + countOverdueMonths(a, currentMonthIdx), 0);
                return (
                  <section key={prog} className={styles.cronProgSection} style={{ borderColor: `${progColor}33` }}>
                    <button
                      type="button"
                      className={styles.cronProgHead}
                      style={{ background: `${progColor}10` }}
                      onClick={() => toggleProg(prog)}
                      aria-expanded={isOpen}
                    >
                      <div className={styles.cronProgHeadGrid}>
                        <div className={styles.cronProgHeadLeft}>
                          {isOpen ? <FiChevronDown size={15} /> : <FiChevronRight size={15} />}
                          <span className={styles.actProgDot} style={{ background: progColor }} />
                          <span className={styles.cronProgName} style={{ color: progColor }}>{prog}</span>
                          <span className={styles.cronProgMeta}>
                            {progDone}/{progActs.length} al 100% · {progCumpl}% prom.
                            {progOverdue > 0 && (
                              <span className={styles.cronOverdueBadge}> · {progOverdue} vencido{progOverdue > 1 ? "s" : ""}</span>
                            )}
                          </span>
                        </div>
                        {MONTHS.map((m, mi) => {
                          const planned = progActs.filter(a => a.planeado[m]).length;
                          const done = progActs.filter(a => a.realizado[m]).length;
                          return (
                            <div
                              key={m}
                              className={`${styles.cronProgMonthStat} ${mi === currentMonthIdx ? styles.cronMonthCurr : ""}`}
                            >
                              {planned > 0 && (
                                <span style={{
                                  color: done === planned ? "#0ea5e9" : done > 0 ? "#f57c00" : mi < currentMonthIdx ? "#e53935" : "#1f7aec",
                                }}>
                                  {done}/{planned}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </button>

                    {isOpen && progActs.map((act, ai) => {
                      const overdue = countOverdueMonths(act, currentMonthIdx);
                      const isHighlight = cronHighlightActId === act.id;
                      return (
                        <div
                          key={act.id}
                          data-cron-act-id={act.id}
                          className={`${styles.cronRow} ${ai % 2 === 1 ? styles.cronRowAlt : ""} ${isHighlight ? styles.cronRowHighlight : ""}`}
                        >
                          <button
                            type="button"
                            className={styles.cronActCol}
                            onClick={() => onGoActividades(act.id)}
                            title="Ver en Actividades"
                          >
                            <span className={styles.cronActName}>{act.actividad}</span>
                            <span className={styles.cronActMeta}>
                              {act.frecuencia && (
                                <span className={styles.cronFreqBadge} style={{
                                  background: `${FREQ_COLORS[act.frecuencia] ?? "#6b7280"}18`,
                                  color: FREQ_COLORS[act.frecuencia] ?? "#6b7280",
                                  borderColor: `${FREQ_COLORS[act.frecuencia] ?? "#6b7280"}30`,
                                }}>{act.frecuencia}</span>
                              )}
                              {act.responsable && <span>{act.responsable}</span>}
                              {overdue > 0 && (
                                <span className={styles.cronOverdueBadge}>{overdue} vencido{overdue > 1 ? "s" : ""}</span>
                              )}
                              {act.cumplimiento !== null && (
                                <span className={styles.cronCumplPct} style={{
                                  color: act.cumplimiento >= 100 ? "#0ea5e9" : act.cumplimiento >= 50 ? "#f57c00" : "#e53935",
                                }}>{act.cumplimiento}%</span>
                              )}
                            </span>
                          </button>
                          {MONTHS.map((m, mi) => {
                            const cell = getCronCell(act, mi, currentMonthIdx);
                            const isCurr = mi === currentMonthIdx;
                            return (
                              <button
                                key={m}
                                type="button"
                                className={[
                                  styles.cronCell,
                                  isCurr ? styles.cronCellCurr : "",
                                  cell?.kind === "done" ? styles.cronCellDone : "",
                                  cell?.kind === "overdue" ? styles.cronCellOverdue : "",
                                  cell?.kind === "planned" ? styles.cronCellPlanned : "",
                                  cell?.kind === "extra" ? styles.cronCellExtra : "",
                                ].filter(Boolean).join(" ")}
                                onClick={() => cell && onGoCalendario(mi, act.programaLabel)}
                                disabled={!cell}
                                title={cell ? `${MES_LARGO[mi]} \u2014 ${cell.kind === "done" ? "Ejecutado" : cell.kind === "overdue" ? "Vencido" : cell.kind === "planned" ? "Pendiente" : "Extra"} (clic \u2192 Calendario)` : undefined}
                              >
                                {cell && <span className={styles.cronCellSym}>{cell.symbol}</span>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.cronFooter}>
          <span>Clic en actividad → pestaña Actividades</span>
          <span>Clic en celda de mes → Calendario de ese mes</span>
          <span className={styles.cronFooterHint}>Grupos colapsados por defecto — usa chips o &quot;Ir a actividad…&quot;</span>
        </div>
      </div>
    </div>
  );
}

function getAlertCalMonth(act: Actividad, currentMonthIdx: number): number {
  if (act.alertas.includes("pendiente_mes_actual") && act.planeado[MONTHS[currentMonthIdx] as Month]) {
    return currentMonthIdx;
  }
  for (let i = 0; i < 12; i++) {
    const m = MONTHS[i] as Month;
    if (act.planeado[m] && !act.realizado[m]) return i;
  }
  for (let i = 0; i < 12; i++) {
    if (act.planeado[MONTHS[i] as Month]) return i;
  }
  return currentMonthIdx;
}

function getCalActStatus(act: Actividad, mi: number, currentMonthIdx: number) {
  return getCronCell(act, mi, currentMonthIdx);
}

function CalendarioPanel({
  acts,
  totalCount,
  calSearch,
  setCalSearch,
  calFPrograma,
  setCalFPrograma,
  calFResponsable,
  setCalFResponsable,
  calSelectedMonth,
  setCalSelectedMonth,
  programas,
  responsables,
  currentMonthIdx,
  onGoActividades,
  onGoPrograma,
}: {
  acts: Actividad[];
  totalCount: number;
  calSearch: string;
  setCalSearch: (v: string) => void;
  calFPrograma: string;
  setCalFPrograma: (v: string) => void;
  calFResponsable: string;
  setCalFResponsable: (v: string) => void;
  calSelectedMonth: number;
  setCalSelectedMonth: (v: number) => void;
  programas: string[];
  responsables: string[];
  currentMonthIdx: number;
  onGoActividades: (actId: string) => void;
  onGoPrograma: (actId: string) => void;
}) {
  const hasFilters = calSearch.trim() || calFPrograma !== "Todos" || calFResponsable !== "Todos";
  const mi = calSelectedMonth;
  const m = MONTHS[mi] as Month;
  const isCurrentMonth = mi === currentMonthIdx;

  const monthStats = useMemo(() => MONTHS.map((month, idx) => {
    const monthActs = acts.filter(a => a.planeado[month] || a.realizado[month]);
    const done = monthActs.filter(a => a.planeado[month] && a.realizado[month]).length;
    const overdue = monthActs.filter(a => a.planeado[month] && !a.realizado[month] && idx < currentMonthIdx).length;
    const pending = monthActs.filter(a => a.planeado[month] && !a.realizado[month] && idx >= currentMonthIdx).length;
    return { total: monthActs.length, done, overdue, pending };
  }), [acts, currentMonthIdx]);

  const monthActs = useMemo(() => {
    const statusOrder: Record<string, number> = { overdue: 0, planned: 1, extra: 2, done: 3 };
    return acts
      .filter(a => a.planeado[m] || a.realizado[m])
      .sort((a, b) => {
        const sa = getCalActStatus(a, mi, currentMonthIdx)?.kind ?? "done";
        const sb = getCalActStatus(b, mi, currentMonthIdx)?.kind ?? "done";
        const diff = (statusOrder[sa] ?? 3) - (statusOrder[sb] ?? 3);
        if (diff !== 0) return diff;
        return a.actividad.localeCompare(b.actividad, "es");
      });
  }, [acts, m, mi, currentMonthIdx]);

  const { done, overdue, pending, total } = useMemo(() => {
    const doneN = monthActs.filter(a => a.planeado[m] && a.realizado[m]).length;
    const overdueN = monthActs.filter(a => a.planeado[m] && !a.realizado[m] && mi < currentMonthIdx).length;
    const pendingN = monthActs.filter(a => a.planeado[m] && !a.realizado[m] && mi >= currentMonthIdx).length;
    return { done: doneN, overdue: overdueN, pending: pendingN, total: monthActs.length };
  }, [monthActs, m, mi, currentMonthIdx]);

  const goMonth = (next: number) => setCalSelectedMonth((next + 12) % 12);

  return (
    <div className={`${styles.section} ${styles.sectionFill}`}>
      <div className={`${styles.tableWrapper} ${styles.tableWrapperFill}`}>
        <div className={styles.calHeaderBar}>
          <div className={styles.calHeaderMain}>
            <div className={styles.calHeaderNav}>
              <button type="button" className={styles.calHeaderNavBtn} onClick={() => goMonth(mi - 1)} aria-label="Mes anterior">
                <FiChevronRight size={16} style={{ transform: "rotate(180deg)" }} />
              </button>
              <button type="button" className={styles.calHeaderNavBtn} onClick={() => goMonth(mi + 1)} aria-label="Mes siguiente">
                <FiChevronRight size={16} />
              </button>
            </div>
            <div className={styles.calHeaderText}>
              <h2 className={styles.calHeaderTitle}>
                {MES_LARGO[mi]} 2026
                <span className={styles.calHoyPill} aria-hidden={!isCurrentMonth} style={{ visibility: isCurrentMonth ? "visible" : "hidden" }}>
                  Hoy
                </span>
              </h2>
              <p className={styles.calHeaderSub}>
                {total} actividad{total !== 1 ? "es" : ""} en {MES_LARGO[mi].toLowerCase()}
                {hasFilters ? " · filtradas" : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`${styles.calTodayBtn} ${isCurrentMonth ? styles.calTodayBtnHidden : ""}`}
            onClick={() => setCalSelectedMonth(currentMonthIdx)}
            disabled={isCurrentMonth}
            tabIndex={isCurrentMonth ? -1 : 0}
          >
            Ir a mes actual
          </button>
        </div>

        <div className={styles.calStrip} role="tablist" aria-label="Meses del año">
          {MES_CORTO.map((label, idx) => {
            const stat = monthStats[idx];
            const isSel = idx === mi;
            const isCurr = idx === currentMonthIdx;
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={isSel}
                data-cal-month={idx}
                className={`${styles.calStripBtn} ${isSel ? styles.calStripBtnActive : ""} ${isCurr ? styles.calStripBtnToday : ""}`}
                onClick={() => setCalSelectedMonth(idx)}
                title={`${MES_LARGO[idx]} — ${stat.total} actividades${stat.overdue > 0 ? `, ${stat.overdue} vencidas` : ""}`}
              >
                <span className={styles.calStripLbl}>{label}</span>
                {stat.total > 0 && <span className={styles.calStripCount}>{stat.total}</span>}
                {stat.overdue > 0 && <span className={styles.calStripDot} />}
              </button>
            );
          })}
        </div>

        <div className={styles.tableControls}>
          <input
            className={styles.tableSearch}
            placeholder="Buscar en este mes…"
            value={calSearch}
            onChange={e => setCalSearch(e.target.value)}
          />
          <select className={styles.tableSelect} value={calFPrograma} onChange={e => setCalFPrograma(e.target.value)}>
            {programas.map(p => <option key={p}>{p}</option>)}
          </select>
          <select className={styles.tableSelect} value={calFResponsable} onChange={e => setCalFResponsable(e.target.value)}>
            {responsables.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        <div className={styles.calKpiRow}>
          <div className={styles.calKpi}>
            <span className={styles.calKpiVal}>{total}</span>
            <span className={styles.calKpiLbl}>En el mes</span>
          </div>
          <div className={`${styles.calKpi} ${styles.calKpiDone}`}>
            <span className={styles.calKpiVal}>✓ {done}</span>
            <span className={styles.calKpiLbl}>Ejecutadas</span>
          </div>
          {overdue > 0 && (
            <div className={`${styles.calKpi} ${styles.calKpiOverdue}`}>
              <span className={styles.calKpiVal}>✗ {overdue}</span>
              <span className={styles.calKpiLbl}>Vencidas</span>
            </div>
          )}
          {pending > 0 && (
            <div className={`${styles.calKpi} ${styles.calKpiPending}`}>
              <span className={styles.calKpiVal}>● {pending}</span>
              <span className={styles.calKpiLbl}>Pendientes</span>
            </div>
          )}
          <div className={styles.calKpiMeta}>
            {totalCount} actividades en el plan anual
          </div>
        </div>

        <div className={`${styles.calListScroll} ${styles.calScrollTall}`} data-lenis-prevent>
          {total === 0 ? (
            <div className={styles.calEmptyState}>
              {hasFilters
                ? "Ninguna actividad coincide con los filtros en este mes."
                : "No hay actividades planificadas para este mes."}
            </div>
          ) : (
            <table className={`${styles.table} ${styles.calTable}`}>
              <thead>
                <tr>
                  <th className={styles.calThStatus}>Estado</th>
                  <th>Actividad</th>
                  <th>Programa</th>
                  <th>Responsable</th>
                  <th className={styles.calThActions}></th>
                </tr>
              </thead>
              <tbody>
                {monthActs.map(a => {
                  const st = getCalActStatus(a, mi, currentMonthIdx);
                  const badgeCls = st?.kind === "done" ? styles.success
                    : st?.kind === "overdue" ? styles.critico
                    : st?.kind === "planned" ? styles.baja
                    : styles.neutral;
                  const badgeLbl = st?.kind === "done" ? "Ejecutada"
                    : st?.kind === "overdue" ? "Vencida"
                    : st?.kind === "planned" ? "Pendiente"
                    : "Extra";
                  return (
                    <tr key={a.id} className={st?.kind === "overdue" ? styles.calRowOverdue : ""}>
                      <td>
                        <span className={`${styles.badge} ${badgeCls}`}>
                          {st?.symbol} {badgeLbl}
                        </span>
                      </td>
                      <td className={styles.calActCell}>
                        <button type="button" className={styles.calActLink} onClick={() => onGoActividades(a.id)}>
                          {a.actividad}
                        </button>
                      </td>
                      <td>
                        <span
                          className={styles.badge}
                          style={{
                            background: `${PROG_COLORS[a.programaLabel] ?? PIE_COLORS[0]}18`,
                            color: PROG_COLORS[a.programaLabel] ?? PIE_COLORS[0],
                            borderColor: `${PROG_COLORS[a.programaLabel] ?? PIE_COLORS[0]}33`,
                          }}
                        >
                          {a.programaLabel}
                        </span>
                      </td>
                      <td className={styles.respCell}>{a.responsable || "—"}</td>
                      <td className={styles.calThActions}>
                        <button type="button" className={styles.calIconBtn} onClick={() => onGoPrograma(a.id)} title="Ver en Programa">
                          <FiCalendar size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function getDeprEstado(act: Actividad): "vencido" | "critico" | "proximo" | "ok" {
  const rest = act.aniosRestantes ?? 0;
  const pct = act.depreciacionPct ?? 0;
  if (rest <= 0 || pct >= 100) return "vencido";
  if (pct >= 80 || rest <= 1) return "critico";
  if (pct >= 60 || rest <= 2) return "proximo";
  return "ok";
}

const DEPR_ESTADO_LABEL: Record<ReturnType<typeof getDeprEstado>, string> = {
  vencido: "Reemplazar",
  critico: "Año crítico",
  proximo: "Planificar",
  ok: "En servicio",
};

function DepreciacionPanel({
  acts,
  sinEquipoCount,
  totalCount,
  deprSearch,
  setDeprSearch,
  deprFPrograma,
  setDeprFPrograma,
  deprFEstado,
  setDeprFEstado,
  programas,
  canEdit,
  onEdit,
  onGoActividades,
}: {
  acts: Actividad[];
  sinEquipoCount: number;
  totalCount: number;
  deprSearch: string;
  setDeprSearch: (v: string) => void;
  deprFPrograma: string;
  setDeprFPrograma: (v: string) => void;
  deprFEstado: string;
  setDeprFEstado: (v: string) => void;
  programas: string[];
  canEdit: boolean;
  onEdit: (act: Actividad) => void;
  onGoActividades: () => void;
}) {
  const chartData = useMemo(
    () => acts.slice(0, 15).map(a => ({
      name: (a.meta.equipoAsociado || a.actividad).slice(0, 32),
      pct: a.depreciacionPct!,
    })),
    [acts],
  );

  const kpis = useMemo(() => {
    const vencidos = acts.filter(a => getDeprEstado(a) === "vencido").length;
    const criticos = acts.filter(a => getDeprEstado(a) === "critico").length;
    const residual = acts.reduce((s, a) => s + (a.valorResidual ?? 0), 0);
    const costo = acts.reduce((s, a) => s + (a.meta.costoCompra ?? 0), 0);
    return { vencidos, criticos, residual, costo };
  }, [acts]);

  const hasFilters = deprSearch.trim() || deprFPrograma !== "Todos" || deprFEstado !== "Todos";

  return (
    <div className={`${styles.section} ${styles.sectionFill}`}>
      <div className={styles.actHeader}>
        <div>
          <h2 className={styles.actTitle}>Depreciación de equipos</h2>
          <p className={styles.actSub}>
            {acts.length} equipos registrados · {sinEquipoCount} actividades sin datos de compra
            {hasFilters ? " (filtrados)" : ""}
          </p>
        </div>
        {sinEquipoCount > 0 && (
          <button type="button" className={styles.calTodayBtn} onClick={onGoActividades}>
            Registrar equipos
          </button>
        )}
      </div>

      <div className={`${styles.tableWrapper} ${styles.tableWrapperFill}`}>
        <div className={styles.calKpiRow}>
          <div className={styles.calKpi}>
            <span className={styles.calKpiVal}>{acts.length}</span>
            <span className={styles.calKpiLbl}>Con depreciación</span>
          </div>
          <div className={`${styles.calKpi} ${styles.calKpiOverdue}`}>
            <span className={styles.calKpiVal}>{kpis.vencidos}</span>
            <span className={styles.calKpiLbl}>Vencidos</span>
          </div>
          <div className={`${styles.calKpi} ${styles.calKpiPending}`}>
            <span className={styles.calKpiVal}>{kpis.criticos}</span>
            <span className={styles.calKpiLbl}>Críticos</span>
          </div>
          <div className={styles.calKpi}>
            <span className={styles.calKpiVal}>{fmtCurrency(kpis.residual)}</span>
            <span className={styles.calKpiLbl}>Valor residual</span>
          </div>
          <div className={styles.calKpi}>
            <span className={styles.calKpiVal}>{fmtCurrency(kpis.costo)}</span>
            <span className={styles.calKpiLbl}>Costo original</span>
          </div>
          <div className={styles.calKpiMeta}>{totalCount} actividades en el plan</div>
        </div>

        <div className={styles.tableControls}>
          <input
            className={styles.tableSearch}
            placeholder="Buscar equipo, actividad, proveedor…"
            value={deprSearch}
            onChange={e => setDeprSearch(e.target.value)}
          />
          <select className={styles.tableSelect} value={deprFPrograma} onChange={e => setDeprFPrograma(e.target.value)}>
            {programas.map(p => <option key={p}>{p}</option>)}
          </select>
          <select className={styles.tableSelect} value={deprFEstado} onChange={e => setDeprFEstado(e.target.value)}>
            <option value="Todos">Todos los estados</option>
            <option value="vencido">Vencidos / reemplazar</option>
            <option value="critico">Año crítico (≥80%)</option>
            <option value="proximo">Planificar (≥60%)</option>
            <option value="ok">En servicio</option>
          </select>
        </div>

        {acts.length >= 5 && (
          <div className={styles.deprChartWrap}>
            <p className={styles.deprChartTitle}>
              <FiTrendingDown size={14} /> Depreciación (% vida útil alcanzada)
            </p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={140} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={v => [`${v}%`, "Depreciación"]} />
                <Bar dataKey="pct" name="% Depreciado" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.pct >= 80 ? "#e53935" : d.pct >= 60 ? "#f57c00" : d.pct >= 40 ? "#f4b000" : "#0ea5e9"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className={`${styles.deprListScroll} ${styles.deprScrollTall}`} data-lenis-prevent>
          {acts.length === 0 ? (
            <div className={styles.calEmptyState}>
              <FiDollarSign size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>No hay equipos con los filtros actuales.</p>
              {sinEquipoCount > 0 && (
                <button type="button" className={styles.calTodayBtn} style={{ marginTop: 12 }} onClick={onGoActividades}>
                  Ir a Actividades para registrar {sinEquipoCount} pendientes
                </button>
              )}
            </div>
          ) : (
            <table className={`${styles.table} ${styles.deprTableCompact}`}>
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th>Actividad</th>
                  <th>Programa</th>
                  <th>F. compra</th>
                  <th>Costo</th>
                  <th>Vida</th>
                  <th>Deprec.</th>
                  <th>Residual</th>
                  <th>Estado</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {acts.map(act => {
                  const pct = act.depreciacionPct ?? 0;
                  const estado = getDeprEstado(act);
                  const badgeCls = estado === "vencido" ? styles.critico
                    : estado === "critico" ? styles.alta
                    : estado === "proximo" ? styles.media
                    : styles.success;
                  return (
                    <tr key={act.id} className={estado === "vencido" || estado === "critico" ? styles.calRowOverdue : ""}>
                      <td className={styles.deprEquipoCell}>{act.meta.equipoAsociado || "—"}</td>
                      <td className={styles.calActCell}>
                        <span className={styles.deprActName} title={act.actividad}>{act.actividad}</span>
                        {act.meta.proveedorEquipo && (
                          <span className={styles.deprProveedor}>{act.meta.proveedorEquipo}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={styles.badge}
                          style={{
                            background: `${PROG_COLORS[act.programaLabel] ?? PIE_COLORS[0]}18`,
                            color: PROG_COLORS[act.programaLabel] ?? PIE_COLORS[0],
                          }}
                        >
                          {act.programaLabel}
                        </span>
                      </td>
                      <td>{fmtDate(act.meta.fechaCompra)}</td>
                      <td className={styles.numCell}>{fmtCurrency(act.meta.costoCompra)}</td>
                      <td className={styles.numCell} title={`${act.vidaAlcanzada ?? 0} de ${act.meta.vidaUtilAnios ?? "?"} años`}>
                        {act.meta.vidaUtilAnios ? `${act.vidaAlcanzada ?? 0}/${act.meta.vidaUtilAnios}a` : "—"}
                      </td>
                      <td className={styles.cumplCell}>
                        <span className={styles.cumplPct} style={{ color: pct >= 80 ? "#e53935" : pct >= 50 ? "#f57c00" : "#0ea5e9" }}>
                          {pct}%
                        </span>
                        <ProgBar pct={pct} cls={pct >= 80 ? "progFillRed" : pct >= 50 ? "progFillYellow" : "progFillGreen"} />
                      </td>
                      <td className={styles.numCell} style={{ color: "#0ea5e9", fontWeight: 600 }}>
                        {fmtCurrency(act.valorResidual ?? undefined)}
                      </td>
                      <td>
                        <span className={`${styles.badge} ${badgeCls}`}>
                          {estado === "vencido" && <FiAlertTriangle size={9} />}
                          {estado === "critico" && <FiAlertCircle size={9} />}
                          {DEPR_ESTADO_LABEL[estado]}
                        </span>
                      </td>
                      {canEdit && (
                      <td>
                        <button type="button" className={styles.editBtn} onClick={() => onEdit(act)} title="Editar actividad">
                          <FiEdit2 size={11} />
                        </button>
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

type AlertLayout = "motivo" | "programa" | "severidad";

function alertSectionKey(layout: AlertLayout, id: string) {
  return `${layout}:${id}`;
}

function levelBreakdown(groups: AlertGroup[]) {
  const c: Record<AlertLevel, number> = { critico: 0, alta: 0, media: 0, baja: 0 };
  groups.forEach(g => { c[g.topLevel]++; });
  return c;
}

function AlertCompactCard({
  group,
  highlight,
  showPrograma,
  showMotivos,
  canEdit,
  onGoActividades,
  onGoPrograma,
  onGoPorMes,
  onEdit,
}: {
  group: AlertGroup;
  highlight: boolean;
  showPrograma: boolean;
  showMotivos: boolean;
  canEdit: boolean;
  onGoActividades: (id: string) => void;
  onGoPrograma: (id: string) => void;
  onGoPorMes: (id: string) => void;
  onEdit: (act: Actividad) => void;
}) {
  const { act, items, topLevel } = group;
  const hasEquipo = items.some(i => i.alerta.includes("equipo"));
  const cumpl = act.cumplimiento ?? 0;
  const cumplColor = cumpl >= 80 ? "#0ea5e9" : cumpl >= 50 ? "#f57c00" : "#e53935";

  return (
    <div
      className={`${styles.alertCardCompact} ${highlight ? styles.alertCardHighlight : ""} ${topLevel === "critico" ? styles.alertCardCritical : ""}`}
      data-alert-act-id={act.id}
      onClick={() => onGoActividades(act.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGoActividades(act.id); } }}
    >
      <span className={styles.alertSevDot} style={{ background: ALERT_LEVEL_COLOR[topLevel] }} title={LEVEL_LABEL[topLevel]} />
      <div className={styles.alertCardBody}>
        <span className={styles.alertActName}>{act.actividad}</span>
        <span className={styles.alertActProg}>
          {showPrograma ? act.programaLabel : act.responsable || "Sin responsable"}
          {" · "}
          <span style={{ color: cumplColor, fontWeight: 600 }}>{cumpl}%</span>
        </span>
        {showMotivos && items.length > 0 && (
          <span className={styles.alertCardMotivos}>
            {items.slice(0, 2).map(i => i.label).join(" · ")}
            {items.length > 2 && ` +${items.length - 2}`}
          </span>
        )}
      </div>
      <div className={styles.alertRowActions} onClick={e => e.stopPropagation()}>
        <button type="button" className={styles.calIconBtn} title="Programa" onClick={() => onGoPrograma(act.id)}>
          <FiCalendar size={13} />
        </button>
        <button type="button" className={styles.calIconBtn} title="Por mes" onClick={() => onGoPorMes(act.id)}>
          <FiClock size={13} />
        </button>
        {canEdit && hasEquipo && (
          <button type="button" className={styles.calIconBtn} title="Editar actividad" onClick={() => onEdit(act)}>
            <FiEdit2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function AlertasPanel({
  groups,
  alertSearch,
  setAlertSearch,
  alertFPrograma,
  setAlertFPrograma,
  alertFLevel,
  setAlertFLevel,
  alertFTipo,
  setAlertFTipo,
  programas,
  highlightActId,
  canEdit,
  onGoActividades,
  onGoPrograma,
  onGoPorMes,
  onEdit,
}: {
  groups: AlertGroup[];
  alertSearch: string;
  setAlertSearch: (v: string) => void;
  alertFPrograma: string;
  setAlertFPrograma: (v: string) => void;
  alertFLevel: string;
  setAlertFLevel: (v: string) => void;
  alertFTipo: string;
  setAlertFTipo: (v: string) => void;
  programas: string[];
  highlightActId: string | null;
  canEdit: boolean;
  onGoActividades: (actId: string) => void;
  onGoPrograma: (actId: string) => void;
  onGoPorMes: (actId: string) => void;
  onEdit: (act: Actividad) => void;
}) {
  const [alertLayout, setAlertLayout] = useState<AlertLayout>("motivo");
  const [alertGroupOpen, setAlertGroupOpen] = useState<Record<string, boolean>>({});
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const filteredBase = useMemo(() => {
    let d = groups;
    if (alertFPrograma !== "Todos") d = d.filter(g => g.act.programaLabel === alertFPrograma);
    if (alertFLevel !== "Todos") d = d.filter(g => g.topLevel === alertFLevel);
    if (alertSearch.trim()) {
      const q = alertSearch.toLowerCase();
      d = d.filter(g =>
        g.act.actividad.toLowerCase().includes(q) ||
        g.act.responsable.toLowerCase().includes(q) ||
        g.items.some(i => i.label.toLowerCase().includes(q)),
      );
    }
    return d;
  }, [groups, alertFPrograma, alertFLevel, alertSearch]);

  const filtered = useMemo(() => {
    if (alertFTipo === "Todas") return filteredBase;
    return filteredBase.filter(g => g.items.some(i => i.alerta === alertFTipo));
  }, [filteredBase, alertFTipo]);

  const motivoChips = useMemo(() => {
    const map = new Map<string, { label: string; level: AlertLevel; acts: Set<string> }>();
    filteredBase.forEach(g => {
      g.items.forEach(item => {
        if (!map.has(item.alerta)) {
          map.set(item.alerta, { label: item.label, level: item.level, acts: new Set() });
        }
        map.get(item.alerta)!.acts.add(g.act.id);
      });
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, level: v.level, count: v.acts.size }))
      .sort((a, b) => {
        const ld = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
        if (ld !== 0) return ld;
        if (a.key === "pendiente_mes_actual") return -1;
        if (b.key === "pendiente_mes_actual") return 1;
        return b.count - a.count;
      });
  }, [filteredBase]);

  const motivoBuckets = useMemo(() => {
    const map = new Map<string, { key: string; label: string; level: AlertLevel; groups: AlertGroup[] }>();
    filtered.forEach(g => {
      g.items.forEach(item => {
        if (!map.has(item.alerta)) {
          map.set(item.alerta, { key: item.alerta, label: item.label, level: item.level, groups: [] });
        }
        const b = map.get(item.alerta)!;
        if (!b.groups.some(x => x.act.id === g.act.id)) b.groups.push(g);
      });
    });
    return Array.from(map.values()).sort((a, b) => {
      const ld = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
      if (ld !== 0) return ld;
      if (a.key === "pendiente_mes_actual") return -1;
      if (b.key === "pendiente_mes_actual") return 1;
      return b.groups.length - a.groups.length;
    });
  }, [filtered]);

  const progBuckets = useMemo(() => {
    const map: Record<string, AlertGroup[]> = {};
    filtered.forEach(g => {
      if (!map[g.act.programaLabel]) map[g.act.programaLabel] = [];
      map[g.act.programaLabel].push(g);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [filtered]);

  const levelBuckets = useMemo(() =>
    LEVEL_ORDER
      .map(level => ({ level, groups: filtered.filter(g => g.topLevel === level) }))
      .filter(b => b.groups.length > 0),
  [filtered]);

  const jumpToAlert = useCallback((actId: string) => {
    const g = filtered.find(x => x.act.id === actId);
    if (!g) return;
    let key: string;
    if (alertLayout === "programa") {
      key = alertSectionKey("programa", g.act.programaLabel);
    } else if (alertLayout === "severidad") {
      key = alertSectionKey("severidad", g.topLevel);
    } else {
      const motivoKey = alertFTipo !== "Todas" ? alertFTipo : g.items[0]?.alerta;
      if (!motivoKey) return;
      key = alertSectionKey("motivo", motivoKey);
    }
    setAlertGroupOpen(prev => ({ ...prev, [key]: true }));
    setPendingScrollId(actId);
  }, [filtered, alertLayout, alertFTipo]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-alert-act-id="${pendingScrollId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setPendingScrollId(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pendingScrollId, alertGroupOpen]);

  useEffect(() => {
    if (!highlightActId) return;
    jumpToAlert(highlightActId);
  }, [highlightActId, jumpToAlert]);

  useEffect(() => {
    if (alertFTipo !== "Todas") {
      setAlertLayout("motivo");
      setAlertGroupOpen(prev => ({ ...prev, [alertSectionKey("motivo", alertFTipo)]: true }));
    }
  }, [alertFTipo]);

  const prevLayoutRef = useRef(alertLayout);
  const alertOpenInitedRef = useRef(false);
  useEffect(() => {
    if (groups.length === 0) return;
    const layoutChanged = prevLayoutRef.current !== alertLayout;
    prevLayoutRef.current = alertLayout;
    if (!layoutChanged && alertOpenInitedRef.current) return;
    alertOpenInitedRef.current = true;

    const open: Record<string, boolean> = {};
    if (alertLayout === "motivo") {
      motivoBuckets.forEach(b => {
        open[alertSectionKey("motivo", b.key)] = b.level === "critico" || b.level === "alta" || b.groups.length <= 3;
      });
    } else if (alertLayout === "programa") {
      progBuckets.forEach(([prog, gs]) => {
        open[alertSectionKey("programa", prog)] = gs.some(g => g.topLevel === "critico" || g.topLevel === "alta") || gs.length <= 2;
      });
    } else {
      levelBuckets.forEach(b => {
        open[alertSectionKey("severidad", b.level)] = b.level === "critico" || b.level === "alta";
      });
    }
    setAlertGroupOpen(open);
  }, [alertLayout, groups.length, motivoBuckets, progBuckets, levelBuckets]);

  const toggleSection = (key: string) =>
    setAlertGroupOpen(prev => ({ ...prev, [key]: !prev[key] }));

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    if (alertLayout === "motivo") motivoBuckets.forEach(b => { next[alertSectionKey("motivo", b.key)] = true; });
    else if (alertLayout === "programa") progBuckets.forEach(([p]) => { next[alertSectionKey("programa", p)] = true; });
    else levelBuckets.forEach(b => { next[alertSectionKey("severidad", b.level)] = true; });
    setAlertGroupOpen(next);
  };

  const hasFilters = alertSearch.trim() || alertFPrograma !== "Todos" || alertFLevel !== "Todos" || alertFTipo !== "Todas";
  const filteredMotivos = useMemo(() => filtered.reduce((s, g) => s + g.items.length, 0), [filtered]);
  const progChipLabels = programas.filter(p => p !== "Todos");

  const renderSection = (sectionKey: string, title: string, meta: string, dotColor: string, sectionGroups: AlertGroup[], showPrograma: boolean, showMotivos: boolean) => {
    const isOpen = alertGroupOpen[sectionKey] ?? false;
    return (
      <div key={sectionKey} className={styles.actProgSection}>
        <button type="button" className={styles.actProgHead} onClick={() => toggleSection(sectionKey)}>
          <span className={styles.actProgHeadLeft}>
            {isOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
            <span className={styles.actProgDot} style={{ background: dotColor }} />
            <span className={styles.actProgName}>{title}</span>
            <span className={styles.actProgMeta}>{meta}</span>
          </span>
          <span className={styles.actProgCumpl}>{sectionGroups.length}</span>
        </button>
        {isOpen && (
          <div className={styles.alertCardGrid}>
            {sectionGroups.map(g => (
              <AlertCompactCard
                key={`${sectionKey}-${g.act.id}`}
                group={g}
                highlight={highlightActId === g.act.id || pendingScrollId === g.act.id}
                showPrograma={showPrograma}
                showMotivos={showMotivos}
                canEdit={canEdit}
                onGoActividades={onGoActividades}
                onGoPrograma={onGoPrograma}
                onGoPorMes={onGoPorMes}
                onEdit={onEdit}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`${styles.section} ${styles.sectionFill}`}>
      <div className={`${styles.tableWrapper} ${styles.tableWrapperFill}`}>
        <div className={styles.alertToolbar}>
          <div className={styles.alertToolbarFilters}>
            <input
              className={styles.tableSearch}
              placeholder="Buscar actividad, responsable, motivo…"
              value={alertSearch}
              onChange={e => setAlertSearch(e.target.value)}
            />
            <select
              className={styles.actJumpSelect}
              value=""
              onChange={e => { if (e.target.value) jumpToAlert(e.target.value); e.target.value = ""; }}
              title="Saltar directo a una alerta"
            >
              <option value="">Ir a alerta…</option>
              {filtered.map(g => (
                <option key={g.act.id} value={g.act.id}>
                  {(g.act.actividad.length > 48 ? `${g.act.actividad.slice(0, 48)}…` : g.act.actividad)} · {LEVEL_LABEL[g.topLevel]}
                </option>
              ))}
            </select>
            <select className={styles.tableSelect} value={alertFPrograma} onChange={e => {
              const v = e.target.value;
              setAlertFPrograma(v);
              if (v !== "Todos" && alertLayout === "programa") {
                setAlertGroupOpen(prev => ({ ...prev, [alertSectionKey("programa", v)]: true }));
              }
            }}>
              {programas.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className={styles.alertLayoutToggle} role="group" aria-label="Agrupar alertas">
            {(["motivo", "programa", "severidad"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                className={`${styles.toggleBtn} ${alertLayout === mode ? styles.toggleBtnActive : ""}`}
                onClick={() => setAlertLayout(mode)}
              >
                {mode === "motivo" ? "Por motivo" : mode === "programa" ? "Por programa" : "Por severidad"}
              </button>
            ))}
          </div>
        </div>

        {alertLayout === "motivo" && motivoChips.length > 0 && (
          <div className={styles.actProgNav}>
            <div className={styles.actProgChips}>
              <button
                type="button"
                className={`${styles.actProgChip} ${alertFTipo === "Todas" ? styles.actProgChipActive : ""}`}
                onClick={() => setAlertFTipo("Todas")}
              >
                Todos <span className={styles.actProgChipCount}>{filteredBase.length}</span>
              </button>
              {motivoChips.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  className={`${styles.actProgChip} ${alertFTipo === chip.key ? styles.actProgChipActive : ""}`}
                  style={{
                    borderColor: alertFTipo === chip.key ? ALERT_LEVEL_COLOR[chip.level] : undefined,
                    color: alertFTipo === chip.key ? ALERT_LEVEL_COLOR[chip.level] : undefined,
                    background: alertFTipo === chip.key ? `${ALERT_LEVEL_COLOR[chip.level]}14` : undefined,
                  }}
                  onClick={() => {
                    setAlertFTipo(alertFTipo === chip.key ? "Todas" : chip.key);
                    setAlertGroupOpen(prev => ({ ...prev, [alertSectionKey("motivo", chip.key)]: true }));
                  }}
                >
                  {chip.label} <span className={styles.actProgChipCount}>{chip.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {alertLayout === "programa" && (
          <div className={styles.actProgNav}>
            <div className={styles.actProgChips}>
              {progChipLabels.map(prog => {
                const count = filteredBase.filter(g => g.act.programaLabel === prog).length;
                if (count === 0) return null;
                const color = PROG_COLORS[prog] ?? PIE_COLORS[0];
                const isActive = alertFPrograma === prog;
                return (
                  <button
                    key={prog}
                    type="button"
                    className={`${styles.actProgChip} ${isActive ? styles.actProgChipActive : ""}`}
                    style={{
                      borderColor: isActive ? color : undefined,
                      color: isActive ? color : undefined,
                      background: isActive ? `${color}14` : undefined,
                    }}
                    onClick={() => {
                      if (isActive) setAlertFPrograma("Todos");
                      else {
                        setAlertFPrograma(prog);
                        setAlertGroupOpen(prev => ({ ...prev, [alertSectionKey("programa", prog)]: true }));
                      }
                    }}
                  >
                    {prog} <span className={styles.actProgChipCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {alertLayout === "severidad" && (
          <div className={styles.alertSegFilter} role="group" aria-label="Filtrar por severidad">
            {(["Todos", ...LEVEL_ORDER] as const).map(lvl => {
              const count = lvl === "Todos" ? filteredBase.length : filteredBase.filter(g => g.topLevel === lvl).length;
              return (
                <button
                  key={lvl}
                  type="button"
                  className={`${styles.alertSegBtn} ${alertFLevel === lvl ? styles.alertSegBtnActive : ""} ${lvl !== "Todos" ? styles[`alertSegBtn_${lvl}`] : ""}`}
                  onClick={() => {
                    setAlertFLevel(lvl);
                    if (lvl !== "Todos") {
                      setAlertGroupOpen(prev => ({ ...prev, [alertSectionKey("severidad", lvl)]: true }));
                    }
                  }}
                >
                  {lvl === "Todos" ? "Todas" : LEVEL_LABEL[lvl]}
                  <span className={styles.alertSegCount}>{count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.alertTableMeta}>
          <span>
            <strong>{filtered.length}</strong> actividades · <strong>{filteredMotivos}</strong> motivos
            {hasFilters ? " (filtradas)" : ""}
          </span>
          <div className={styles.actProgBulk}>
            <button type="button" className={styles.actProgBulkBtn} onClick={expandAll}>Expandir todo</button>
            <span className={styles.actProgBulkSep}>·</span>
            <button type="button" className={styles.actProgBulkBtn} onClick={() => setAlertGroupOpen({})}>Colapsar todo</button>
          </div>
        </div>

        <div className={`${styles.alertListScroll} ${styles.alertScrollTall}`} data-lenis-prevent>
          {filtered.length === 0 ? (
            <div className={styles.calEmptyState}>
              <FiCheckCircle size={32} color="#0ea5e9" style={{ marginBottom: 8 }} />
              <p>{groups.length === 0 ? "¡Sin alertas activas! Todo en orden." : "Ninguna alerta coincide con los filtros."}</p>
            </div>
          ) : alertLayout === "motivo" ? (
            motivoBuckets.map(b => renderSection(
              alertSectionKey("motivo", b.key),
              b.label,
              `${b.groups.length} actividades`,
              ALERT_LEVEL_COLOR[b.level],
              b.groups,
              true,
              false,
            ))
          ) : alertLayout === "programa" ? (
            progBuckets.map(([prog, gs]) => {
              const br = levelBreakdown(gs);
              const meta = [
                br.critico ? `${br.critico} crít.` : "",
                br.alta ? `${br.alta} altas` : "",
              ].filter(Boolean).join(" · ") || `${gs.length} actividades`;
              return renderSection(
                alertSectionKey("programa", prog),
                prog,
                meta,
                PROG_COLORS[prog] ?? PIE_COLORS[0],
                gs,
                false,
                true,
              );
            })
          ) : (
            levelBuckets.map(b => renderSection(
              alertSectionKey("severidad", b.level),
              LEVEL_LABEL[b.level],
              `${b.groups.length} actividades`,
              ALERT_LEVEL_COLOR[b.level],
              b.groups,
              true,
              true,
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProgramaAnualPage() {
  const { role } = useAuthSession();
  const canEdit = canEditProgramaAnual(role);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings]           = useState(false);
  const { showCalendar } = useCalendarToggle();
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();

  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string|null>(null);

  const [activeTab, setActiveTab] = useState<"overview"|"actividades"|"cronograma"|"mantenimientos"|"depreciacion"|"alertas">("overview");
  const [cronSearch, setCronSearch] = useState("");
  const [cronFPrograma, setCronFPrograma] = useState("Todos");
  const [cronFResponsable, setCronFResponsable] = useState("Todos");
  const [cronProgOpen, setCronProgOpen] = useState<Record<string, boolean>>({});
  const [cronHighlightActId, setCronHighlightActId] = useState<string | null>(null);
  const [actSearch, setActSearch] = useState("");
  const [fPrograma, setFPrograma] = useState("Todos");
  const [fFrecuencia, setFFrec]   = useState("Todas");
  const [fAlerta, setFAlerta]     = useState("Todas");
  const [page, setPage]           = useState(1);
  const [editDrawerState, setEditDrawerState] = useState<EditDrawerState | null>(null);
  const [calSelectedMonth, setCalSelectedMonth] = useState(() => new Date().getMonth());
  const [calSearch, setCalSearch] = useState("");
  const [calFPrograma, setCalFPrograma] = useState("Todos");
  const [calFResponsable, setCalFResponsable] = useState("Todos");
  const [deprSearch, setDeprSearch] = useState("");
  const [deprFPrograma, setDeprFPrograma] = useState("Todos");
  const [deprFEstado, setDeprFEstado] = useState("Todos");
  const [alertSearch, setAlertSearch] = useState("");
  const [alertFPrograma, setAlertFPrograma] = useState("Todos");
  const [alertFLevel, setAlertFLevel] = useState("Todos");
  const [alertFTipo, setAlertFTipo] = useState("Todas");
  const [actViewFull, setActViewFull] = useState(false);
  const [actShowAll, setActShowAll]   = useState(true);
  const [actLayout, setActLayout]     = useState<"programas"|"lista">("programas");
  const [actProgOpen, setActProgOpen] = useState<Record<string, boolean>>({});
  const [expandedActId, setExpandedActId] = useState<string|null>(null);
  const [highlightActId, setHighlightActId] = useState<string|null>(null);

  const editingActId = editDrawerState?.kind === "edit" ? editDrawerState.act.id : null;

  const programaOptions = useMemo(() => {
    const map = new Map<string, string>();
    PROGRAMA_DEFAULTS.forEach(p => map.set(p.key, p.label));
    actividades.forEach(a => map.set(a.programa, a.programaLabel));
    return Array.from(map.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [actividades]);

  const currentMonthIdx = new Date().getMonth();
  const getNextMaint = (act: Actividad) => {
    for (let i = currentMonthIdx + 1; i < 12; i++) {
      if (act.planeado[MONTHS[i] as Month]) return MONTHS[i];
    }
    for (let i = 0; i <= currentMonthIdx; i++) {
      if (act.planeado[MONTHS[i] as Month]) return MONTHS[i];
    }
    return null;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(resolveProgramaAnualApi(), { cache: "no-store", credentials: "include" });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg = typeof (data as { error?: unknown })?.error === "string"
          ? (data as { error: string }).error
          : `Error ${res.status}`;
        throw new Error(msg);
      }
      if (!Array.isArray(data)) throw new Error("Respuesta inválida del servidor");
      setActividades(data as Actividad[]);
    } catch (e) {
      setActividades([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar las actividades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const programas   = useMemo(() => ["Todos", ...Array.from(new Set(actividades.map(a=>a.programaLabel)))], [actividades]);
  const frecuencias = useMemo(() => ["Todas", ...Array.from(new Set(actividades.map(a=>a.frecuencia).filter(Boolean))).sort()], [actividades]);
  const responsables = useMemo(
    () => ["Todos", ...Array.from(new Set(actividades.map(a => a.responsable || "Sin asignar"))).sort((a, b) => a.localeCompare(b, "es"))],
    [actividades],
  );

  const cronFiltered = useMemo(() => {
    let d = actividades;
    if (cronFPrograma !== "Todos") d = d.filter(a => a.programaLabel === cronFPrograma);
    if (cronFResponsable !== "Todos") d = d.filter(a => (a.responsable || "Sin asignar") === cronFResponsable);
    if (cronSearch.trim()) {
      const q = cronSearch.toLowerCase();
      d = d.filter(a =>
        a.actividad.toLowerCase().includes(q) ||
        a.responsable.toLowerCase().includes(q) ||
        a.programaLabel.toLowerCase().includes(q),
      );
    }
    return d;
  }, [actividades, cronFPrograma, cronFResponsable, cronSearch]);

  const calFiltered = useMemo(() => {
    let d = actividades;
    if (calFPrograma !== "Todos") d = d.filter(a => a.programaLabel === calFPrograma);
    if (calFResponsable !== "Todos") d = d.filter(a => (a.responsable || "Sin asignar") === calFResponsable);
    if (calSearch.trim()) {
      const q = calSearch.toLowerCase();
      d = d.filter(a =>
        a.actividad.toLowerCase().includes(q) ||
        a.responsable.toLowerCase().includes(q) ||
        a.programaLabel.toLowerCase().includes(q),
      );
    }
    return d;
  }, [actividades, calFPrograma, calFResponsable, calSearch]);

  const filtered = useMemo(() => {
    let d = actividades;
    if (fPrograma !== "Todos")     d = d.filter(a => a.programaLabel === fPrograma);
    if (fFrecuencia !== "Todas")   d = d.filter(a => a.frecuencia === fFrecuencia);
    if (fAlerta !== "Todas")       d = d.filter(a => a.alertas.includes(fAlerta));
    if (actSearch.trim()) {
      const q = actSearch.toLowerCase();
      d = d.filter(a => a.actividad.toLowerCase().includes(q) || a.responsable.toLowerCase().includes(q) || a.programaLabel.toLowerCase().includes(q));
    }
    return d;
  }, [actividades, fPrograma, fFrecuencia, fAlerta, actSearch]);

  const paginated = useMemo(() => {
    if (actShowAll) return filtered;
    return filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [filtered, page, actShowAll]);
  const totalPages   = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const filteredByProg = useMemo(() => {
    const map: Record<string, Actividad[]> = {};
    filtered.forEach(a => {
      if (!map[a.programaLabel]) map[a.programaLabel] = [];
      map[a.programaLabel].push(a);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [filtered]);

  const progChipLabels = useMemo(
    () => programas.filter(p => p !== "Todos"),
    [programas],
  );

  const openEdit = useCallback((act: Actividad) => {
    if (!canEdit) return;
    setExpandedActId(null);
    setEditDrawerState({ kind: "edit", act });
  }, [canEdit]);

  const openCreate = useCallback(() => {
    if (!canEdit) return;
    setExpandedActId(null);
    setEditDrawerState({ kind: "create" });
  }, [canEdit]);

  const actRowHelpers = useMemo(() => ({
    getNextMaint,
    onToggleExpand: (id: string) => setExpandedActId(prev => (prev === id ? null : id)),
    onEdit: openEdit,
    canEdit,
  }), [openEdit, canEdit]);

  const jumpToAct = useCallback((id: string) => {
    const act = actividades.find(a => a.id === id);
    if (!act) return;
    setActLayout("programas");
    setActProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
    setHighlightActId(id);
  }, [actividades]);

  const jumpToCronAct = useCallback((id: string) => {
    const act = actividades.find(a => a.id === id);
    if (!act) return;
    setCronProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
    setCronHighlightActId(id);
  }, [actividades]);

  const goCalendarioMonth = useCallback((monthIdx: number, programaLabel: string) => {
    setActiveTab("mantenimientos");
    setCalSelectedMonth(monthIdx);
    setCalFPrograma(programaLabel);
  }, []);

  const goProgramaFromCal = useCallback((actId: string) => {
    const act = actividades.find(a => a.id === actId);
    if (!act) return;
    setActiveTab("cronograma");
    setCronProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
    setCronHighlightActId(actId);
  }, [actividades]);

  const goActividadesFromCron = useCallback((actId: string) => {
    const act = actividades.find(a => a.id === actId);
    if (!act) return;
    setActiveTab("actividades");
    setActLayout("programas");
    setActProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
    setHighlightActId(actId);
  }, [actividades]);

  const toggleProgSection = useCallback((prog: string) => {
    setActProgOpen(prev => ({ ...prev, [prog]: !prev[prog] }));
  }, []);

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    const total   = actividades.length;
    const cumOk   = actividades.filter(a => (a.cumplimiento ?? 0) >= 100).length;
    const cumArr  = actividades.map(a=>a.cumplimiento).filter(v=>v!==null) as number[];
    const avgCum  = cumArr.length ? Math.round(cumArr.reduce((a,b)=>a+b,0)/cumArr.length) : 0;
    const alertCount = actividades.reduce((s,a)=>s+a.alertas.length, 0);
    const pendMes = actividades.filter(a=>a.alertas.includes("pendiente_mes_actual")).length;
    const conEquipo = actividades.filter(a=>a.meta.fechaCompra).length;
    const depVenc = actividades.filter(a=>a.alertas.includes("equipo_vida_vencida")).length;
    return { total, cumOk, avgCum, alertCount, pendMes, conEquipo, depVenc };
  }, [actividades]);

  /* ── Chart data ── */
  const cumplMesData = useMemo(() => MONTHS.map((m,i) => ({
    mes: MES_CORTO[i],
    Planeado:  actividades.filter(a=>a.planeado[m]).length,
    Realizado: actividades.filter(a=>a.realizado[m]).length,
    Pendiente: actividades.filter(a=>a.planeado[m] && !a.realizado[m]).length,
  })), [actividades]);

  const progData = useMemo(() => {
    const map: Record<string,{total:number,cumplOk:number}> = {};
    actividades.forEach(a => {
      if (!map[a.programaLabel]) map[a.programaLabel]={total:0,cumplOk:0};
      map[a.programaLabel].total++;
      if ((a.cumplimiento??0)>=100) map[a.programaLabel].cumplOk++;
    });
    return Object.entries(map).map(([name,{total,cumplOk}])=>({name, total, cumplOk, pct:Math.round((cumplOk/total)*100)}));
  }, [actividades]);

  const respData = useMemo(() => {
    const map: Record<string,{total:number,real:number}> = {};
    actividades.forEach(a=>{
      const k=a.responsable||"Sin asignar";
      if(!map[k]) map[k]={total:0,real:0};
      map[k].total++;
      if((a.cumplimiento??0)>=100) map[k].real++;
    });
    return Object.entries(map).map(([name,{total,real}])=>({name,total,Cumplidos:real,Pendientes:total-real}))
      .sort((a,b)=>b.total-a.total).slice(0,8);
  }, [actividades]);

  /* ── Alerts (agrupadas por actividad) ── */
  const alertGroups = useMemo(() => buildAlertGroups(actividades), [actividades]);
  const alertMotivosCount = useMemo(
    () => alertGroups.reduce((s, g) => s + g.items.length, 0),
    [alertGroups],
  );

  /* ── Depreciation data ── */
  const deprData = useMemo(() =>
    actividades.filter(a => a.depreciacionPct !== null)
      .sort((a, b) => (b.depreciacionPct ?? 0) - (a.depreciacionPct ?? 0)),
  [actividades]);

  const deprFiltered = useMemo(() => {
    let d = deprData;
    if (deprFPrograma !== "Todos") d = d.filter(a => a.programaLabel === deprFPrograma);
    if (deprFEstado !== "Todos") d = d.filter(a => getDeprEstado(a) === deprFEstado);
    if (deprSearch.trim()) {
      const q = deprSearch.toLowerCase();
      d = d.filter(a =>
        a.actividad.toLowerCase().includes(q) ||
        (a.meta.equipoAsociado ?? "").toLowerCase().includes(q) ||
        (a.meta.proveedorEquipo ?? "").toLowerCase().includes(q),
      );
    }
    return d;
  }, [deprData, deprFPrograma, deprFEstado, deprSearch]);

  const sinEquipoCount = useMemo(
    () => actividades.filter(a => !a.meta.fechaCompra || !a.meta.vidaUtilAnios).length,
    [actividades],
  );

  const plannedThisMonth = useMemo(
    () => actividades.filter(a => a.planeado[MONTHS[currentMonthIdx] as Month]).length,
    [actividades, currentMonthIdx],
  );

  const topAlerts = useMemo(
    () => alertGroups.filter(g => g.topLevel === "critico" || g.topLevel === "alta").slice(0, 3),
    [alertGroups],
  );

  const progDataSorted = useMemo(
    () => [...progData].sort((a, b) => a.pct - b.pct),
    [progData],
  );

  const goTab = useCallback((tab: typeof activeTab, opts?: { alerta?: string; actId?: string; calMonth?: number }) => {
    setActiveTab(tab);
    setPage(1);
    if (opts?.alerta) {
      setAlertFTipo(opts.alerta);
      setAlertFLevel("Todos");
    }
    if (opts?.calMonth !== undefined) setCalSelectedMonth(opts.calMonth);
    if (opts?.actId) {
      const act = actividades.find(a => a.id === opts.actId);
      if (!act) return;
      if (tab === "actividades") {
        setActLayout("programas");
        setActProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
        setHighlightActId(opts.actId);
      } else if (tab === "cronograma") {
        setCronProgOpen(prev => ({ ...prev, [act.programaLabel]: true }));
        setCronHighlightActId(opts.actId);
      } else if (tab === "alertas") {
        setHighlightActId(opts.actId);
      } else {
        setHighlightActId(opts.actId);
      }
    }
  }, [actividades]);

  const goAlertPorMes = useCallback((actId: string) => {
    const act = actividades.find(a => a.id === actId);
    if (!act) return;
    setActiveTab("mantenimientos");
    setCalSelectedMonth(getAlertCalMonth(act, currentMonthIdx));
    setCalFPrograma(act.programaLabel);
  }, [actividades, currentMonthIdx]);

  useEffect(() => {
    if (activeTab !== "actividades" || !highlightActId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-act-id="${highlightActId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    const clear = window.setTimeout(() => setHighlightActId(null), 3500);
    return () => { window.clearTimeout(timer); window.clearTimeout(clear); };
  }, [activeTab, highlightActId, paginated, actShowAll, actLayout, actProgOpen, filteredByProg]);

  useEffect(() => {
    if (activeTab !== "cronograma" || !cronHighlightActId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-cron-act-id="${cronHighlightActId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    const clear = window.setTimeout(() => setCronHighlightActId(null), 3500);
    return () => { window.clearTimeout(timer); window.clearTimeout(clear); };
  }, [activeTab, cronHighlightActId, cronFiltered, cronProgOpen]);

  useEffect(() => {
    if (activeTab !== "mantenimientos") return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-cal-month="${calSelectedMonth}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeTab, calSelectedMonth]);

  return (
    <div className={`${pageStyles.page} ${poppins.className} ${collapsed?pageStyles.collapsed:""} ${darkMode?pageStyles.dark:""} ${sidebarRight?pageStyles.sidebarRight:""}`}>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <main className={`${pageStyles.main} ${!showCalendar && (activeTab === "overview" || activeTab === "actividades" || activeTab === "cronograma" || activeTab === "mantenimientos" || activeTab === "depreciacion" || activeTab === "alertas") ? styles.mainOverviewFit : ""}`}>
        <Header
          showNotifications={showNotifications} setShowNotifications={setShowNotifications}
          showSettings={showSettings} setShowSettings={setShowSettings}
          darkMode={darkMode} setDarkMode={setDarkMode}
          sidebarRight={sidebarRight} setSidebarRight={setSidebarRight}
        />
        <PageContent>
        {editDrawerState && canEdit && (
          <ActividadEditDrawer
            state={editDrawerState}
            programaOptions={programaOptions}
            onClose={() => setEditDrawerState(null)}
            onSaved={load}
          />
        )}

          <div className={`${styles.contentBody} ${activeTab === "overview" ? styles.contentBodyOverview : ""} ${activeTab === "actividades" ? styles.contentBodyActividades : ""} ${activeTab === "cronograma" ? styles.contentBodyCronograma : ""} ${activeTab === "mantenimientos" ? styles.contentBodyCalendario : ""} ${activeTab === "depreciacion" ? styles.contentBodyDepreciacion : ""} ${activeTab === "alertas" ? styles.contentBodyAlertas : ""}`}>
            {/* Tabs */}
            <div className={styles.tabRow}>
              {(["overview","actividades","cronograma","mantenimientos","depreciacion","alertas"] as const).map(t=>(
                <button key={t} className={`${styles.tab} ${activeTab===t?styles.active:""}`} onClick={()=>{setActiveTab(t);setPage(1);}}>
                  {t==="overview"?"Resumen":t==="actividades"?"Actividades":t==="cronograma"?"Programa":t==="mantenimientos"?"Por mes":t==="depreciacion"?"Depreciación":"Alertas"}
                  {t==="alertas" && alertGroups.length>0 && (
                    <span style={{background:"#e53935",color:"#fff",borderRadius:999,padding:"1px 7px",fontSize:10,fontWeight:700}}>{alertGroups.length}</span>
                  )}
                </button>
              ))}
              {!canEdit && (
                <span className={styles.readOnlyBadge} title="Los usuarios estándar solo pueden consultar">Solo lectura</span>
              )}
              {canEdit && (
                <button type="button" className={styles.addActBtn} onClick={openCreate}>
                  <FiPlus size={14} /> Nueva actividad
                </button>
              )}
            </div>

            {loading && <div className={styles.loading}><FiClock style={{marginRight:6}} />Cargando actividades…</div>}
            {error && <div className={styles.empty} style={{color:"#e53935"}}><FiXCircle /> {error}</div>}

            {/* ═══════ OVERVIEW ═══════ */}
            {!loading && !error && activeTab==="overview" && (
              <div className={styles.overview}>
                <div className={styles.overviewHeader}>
                  <div>
                    <h2 className={styles.overviewTitle}>Plan Anual 2026</h2>
                    <p className={styles.overviewSub}>
                      Vista ejecutiva · {progData.length} programas · {kpis.total} actividades registradas
                    </p>
                  </div>
                  <span className={styles.overviewMonthBadge}>
                    <FiCalendar size={14} />
                    {MES_LARGO[currentMonthIdx]} — mes en curso
                  </span>
                </div>

                <div className={styles.pbiMetricBand}>
                  <button type="button" className={`${styles.pbiMetric} ${styles.pbiMetricBlue} ${styles.pbiMetricClickable}`} onClick={() => goTab("actividades")}>
                    <span className={styles.pbiMetricIcon} style={{ background: "rgba(31,122,236,.12)", color: "#1f7aec" }}><FiList size={16} /></span>
                    <span className={styles.pbiLabel}>Total actividades</span>
                    <span className={styles.pbiNum}>{kpis.total}</span>
                    <span className={styles.pbiSub}>{progData.length} programas · año 2026</span>
                    <span className={styles.pbiMetricAction}>Ver listado <FiArrowRight size={12} /></span>
                  </button>
                  <button type="button" className={`${styles.pbiMetric} ${kpis.avgCum>=80?styles.pbiMetricGreen:kpis.avgCum>=50?styles.pbiMetricOrange:styles.pbiMetricRed} ${styles.pbiMetricClickable}`} onClick={() => goTab("actividades")}>
                    <span className={styles.pbiMetricIcon} style={{ background: "rgba(14,165,233,.12)", color: "#0ea5e9" }}><FiCheckCircle size={16} /></span>
                    <span className={styles.pbiLabel}>Cumplimiento promedio</span>
                    <span className={styles.pbiNum}>{kpis.avgCum}<span className={styles.pbiUnit}>%</span></span>
                    <span className={styles.pbiSub}>{kpis.cumOk} actividades al 100%</span>
                    <div className={styles.pbiMiniBar}><div className={styles.pbiMiniFill} style={{ width: `${kpis.avgCum}%`, background: kpis.avgCum>=80?"#0ea5e9":kpis.avgCum>=50?"#f57c00":"#e53935" }} /></div>
                  </button>
                  <button type="button" className={`${styles.pbiMetric} ${kpis.pendMes>0?styles.pbiMetricOrange:styles.pbiMetricGreen} ${styles.pbiMetricClickable}`} onClick={() => goTab("alertas", { alerta: "pendiente_mes_actual" })}>
                    <span className={styles.pbiMetricIcon} style={{ background: "rgba(245,124,0,.12)", color: "#f57c00" }}><FiClock size={16} /></span>
                    <span className={styles.pbiLabel}>Pendientes este mes</span>
                    <span className={styles.pbiNum}>{kpis.pendMes}</span>
                    <span className={styles.pbiSub}>de {plannedThisMonth} planeadas en {MES_CORTO[currentMonthIdx]}</span>
                    <div className={styles.pbiMiniBar}><div className={styles.pbiMiniFill} style={{ width: `${plannedThisMonth>0?Math.round((kpis.pendMes/plannedThisMonth)*100):0}%`, background: kpis.pendMes>0?"#f57c00":"#0ea5e9" }} /></div>
                    <span className={styles.pbiMetricAction}>Revisar pendientes <FiArrowRight size={12} /></span>
                  </button>
                  <button type="button" className={`${styles.pbiMetric} ${alertGroups.length>10?styles.pbiMetricRed:alertGroups.length>0?styles.pbiMetricOrange:styles.pbiMetricGreen} ${styles.pbiMetricClickable}`} onClick={() => goTab("alertas")}>
                    <span className={styles.pbiMetricIcon} style={{ background: "rgba(229,57,53,.12)", color: "#e53935" }}><FiAlertTriangle size={16} /></span>
                    <span className={styles.pbiLabel}>Alertas activas</span>
                    <span className={styles.pbiNum}>{alertGroups.length}</span>
                    <span className={styles.pbiSub}>{alertMotivosCount} motivos · {alertGroups.filter(g=>g.topLevel==="critico").length} críticas · {alertGroups.filter(g=>g.topLevel==="alta").length} altas</span>
                    <div className={styles.pbiMiniBar}><div className={styles.pbiMiniFill} style={{ width: `${Math.min(100, alertGroups.length*4)}%`, background: alertGroups.length>10?"#e53935":"#f57c00" }} /></div>
                    <span className={styles.pbiMetricAction}>Ver alertas <FiArrowRight size={12} /></span>
                  </button>
                </div>

                <div className={styles.overviewBody}>
                <div className={styles.overviewMainGrid}>
                  <div className={styles.chartHero}>
                    <div className={styles.chartHeroHead}>
                      <div>
                        <h3 className={styles.chartHeroTitle}><FiBarChart2 /> Ejecución mensual</h3>
                        <p className={styles.chartHeroDesc}>Planeado vs realizado a lo largo del año · mes actual resaltado</p>
                      </div>
                      <div className={styles.chartHeroLegend}>
                        <span><i style={{ background: "#1f7aec" }} /> Planeado</span>
                        <span><i style={{ background: "#0ea5e9" }} /> Realizado</span>
                        <span><i style={{ background: "#e53935" }} /> Pendiente</span>
                      </div>
                    </div>
                    <div className={styles.chartHeroPlot}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cumplMesData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="18%">
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" vertical={false} />
                        <XAxis
                          dataKey="mes"
                          tick={({ x, y, payload, index }) => (
                            <text
                              x={x}
                              y={y}
                              dy={14}
                              textAnchor="middle"
                              fill={index === currentMonthIdx ? "#0ea5e9" : "var(--text-dim)"}
                              fontSize={11}
                              fontWeight={index === currentMonthIdx ? 700 : 500}
                            >
                              {payload.value}{index === currentMonthIdx ? " ●" : ""}
                            </text>
                          )}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--border)" }}
                          labelFormatter={(label) => `${label}${cumplMesData.find(d => d.mes === label)?.mes === MES_CORTO[currentMonthIdx] ? " (mes actual)" : ""}`}
                        />
                        <Bar dataKey="Planeado" fill="#1f7aec" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Realizado" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={28} />
                        <Bar dataKey="Pendiente" fill="#e53935" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  </div>

                  <aside className={styles.progPanel}>
                    <div className={styles.progPanelHead}>
                      <h3 className={styles.progPanelTitle}>Cumplimiento por programa</h3>
                      <button type="button" className={styles.progPanelLink} onClick={() => goTab("cronograma")}>
                        Ver programa <FiArrowRight size={12} />
                      </button>
                    </div>
                    <div className={styles.progCardList}>
                      {progDataSorted.map(p => {
                        const color = PROG_COLORS[p.name] ?? "#1f7aec";
                        const pctColor = p.pct >= 80 ? "#0ea5e9" : p.pct >= 50 ? "#f57c00" : "#e53935";
                        return (
                          <div key={p.name} className={styles.progCard} style={{ borderLeft: `3px solid ${color}` }}>
                            <div className={styles.progCardTop}>
                              <span className={styles.progCardName}>{p.name}</span>
                              <span className={styles.progCardPct} style={{ color: pctColor }}>{p.pct}%</span>
                            </div>
                            <div className={styles.progCardMeta}>{p.cumplOk} de {p.total} actividades al 100%</div>
                            <div className={styles.progCardBar}>
                              <div style={{ height: "100%", width: `${p.pct}%`, background: color, borderRadius: 999 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </aside>
                </div>

                <div className={styles.overviewBottomGrid}>
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}><FiUsers /> Carga por responsable</h3>
                    <p className={styles.chartDesc}>Actividades cumplidas vs pendientes — top responsables</p>
                    <div className={styles.chartPlot}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={respData} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }} barSize={14}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={118} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Cumplidos" fill="#0ea5e9" radius={[0, 4, 4, 0]} stackId="a" />
                        <Bar dataKey="Pendientes" fill="#e53935" radius={[0, 4, 4, 0]} stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                  </div>

                  <div className={styles.alertPreviewPanel}>
                    <div className={styles.alertPreviewHead}>
                      <h3 className={styles.alertPreviewTitle}><FiAlertTriangle /> Requiere atención</h3>
                      {alertGroups.length > 0 && (
                        <span className={styles.alertPreviewCount}>{alertGroups.filter(g => g.topLevel === "critico" || g.topLevel === "alta").length} urgentes</span>
                      )}
                    </div>
                    {topAlerts.length === 0 ? (
                      <div className={styles.alertPreviewEmpty}>
                        <FiCheckCircle size={28} color="#0ea5e9" />
                        <span>Sin alertas críticas ni altas</span>
                      </div>
                    ) : (
                      <div className={styles.alertPreviewList}>
                        {topAlerts.map(g => (
                          <button
                            key={g.act.id}
                            type="button"
                            className={styles.alertPreviewItem}
                            onClick={() => goTab("alertas", { actId: g.act.id })}
                          >
                            <span className={styles.alertPreviewDot} style={{ background: ALERT_LEVEL_COLOR[g.topLevel] }} />
                            <span className={styles.alertPreviewBody}>
                              <span className={styles.alertPreviewAct}>{g.act.actividad}</span>
                              <span className={styles.alertPreviewReason}>
                                {g.items[0]?.label ?? "Alerta"}
                                {g.items.length > 1 && ` +${g.items.length - 1}`}
                              </span>
                            </span>
                            <FiArrowRight size={14} style={{ opacity: 0.35, flexShrink: 0, marginTop: 4 }} />
                          </button>
                        ))}
                      </div>
                    )}
                    <button type="button" className={styles.progPanelLink} onClick={() => goTab("alertas")} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                      Ver todas las alertas ({alertGroups.length}) <FiArrowRight size={12} />
                    </button>
                  </div>
                </div>
                </div>

                <div className={styles.quickNav}>
                  <button type="button" className={styles.quickNavBtn} onClick={() => goTab("actividades")}>
                    <FiList size={15} /> Actividades <FiArrowRight size={13} />
                  </button>
                  <button type="button" className={styles.quickNavBtn} onClick={() => goTab("cronograma")}>
                    <FiCalendar size={15} /> Programa anual <FiArrowRight size={13} />
                  </button>
                  <button type="button" className={styles.quickNavBtn} onClick={() => goTab("mantenimientos")}>
                    <FiClock size={15} /> Por mes <FiArrowRight size={13} />
                  </button>
                  <button type="button" className={styles.quickNavBtn} onClick={() => goTab("alertas")}>
                    <FiAlertTriangle size={15} /> Alertas <FiArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* ═══════ ACTIVIDADES ═══════ */}
            {!loading && !error && activeTab==="actividades" && (
              <div className={`${styles.section} ${styles.sectionFill}`}>
                <div className={styles.actHeader}>
                  <div>
                    <h2 className={styles.actTitle}>Listado de actividades</h2>
                    <p className={styles.actSub}>
                      {filtered.length} de {actividades.length} actividades
                      {actSearch.trim() || fPrograma !== "Todos" || fFrecuencia !== "Todas" ? " (filtradas)" : ""}
                    </p>
                  </div>
                  <div className={styles.prLegendBadge}>
                    <span className={styles.prLegendItem}><strong>P</strong> Planeado</span>
                    <span className={styles.prLegendSep}>·</span>
                    <span className={styles.prLegendItem}><strong>R</strong> Realizado</span>
                  </div>
                  {canEdit && (
                    <button type="button" className={styles.addActBtn} onClick={openCreate}>
                      <FiPlus size={14} /> Nueva actividad
                    </button>
                  )}
                </div>

                <div className={`${styles.tableWrapper} ${styles.tableWrapperFill}`}>
                  <div className={styles.tableControls}>
                    <input className={styles.tableSearch} placeholder="Buscar actividad, responsable…"
                      value={actSearch} onChange={e=>{setActSearch(e.target.value);setPage(1);}}/>
                    <select
                      className={styles.actJumpSelect}
                      value=""
                      onChange={e => { if (e.target.value) jumpToAct(e.target.value); e.target.value = ""; }}
                      title="Saltar directamente a una actividad"
                    >
                      <option value="">Ir a actividad…</option>
                      {filtered.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.actividad.length > 55 ? `${a.actividad.slice(0, 55)}…` : a.actividad} · {a.programaLabel}
                        </option>
                      ))}
                    </select>
                    <select className={styles.tableSelect} value={fPrograma} onChange={e=>{
                      const v = e.target.value;
                      setFPrograma(v);
                      setPage(1);
                      if (v !== "Todos") setActProgOpen(prev => ({ ...prev, [v]: true }));
                    }}>
                      {programas.map(p=><option key={p}>{p}</option>)}
                    </select>
                    <select className={styles.tableSelect} value={fFrecuencia} onChange={e=>{setFFrec(e.target.value);setPage(1);}}>
                      {frecuencias.map(f=><option key={f}>{f}</option>)}
                    </select>
                    <div className={styles.actToolbarToggles}>
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${actLayout === "programas" ? styles.toggleBtnActive : ""}`}
                        onClick={() => setActLayout("programas")}
                      >
                        Por programas
                      </button>
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${actLayout === "lista" ? styles.toggleBtnActive : ""}`}
                        onClick={() => setActLayout("lista")}
                      >
                        Lista plana
                      </button>
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${actViewFull ? styles.toggleBtnActive : ""}`}
                        onClick={() => { setActViewFull(v => !v); setExpandedActId(null); }}
                      >
                        {actViewFull ? "Vista compacta" : "Vista completa"}
                      </button>
                      {actLayout === "lista" && (
                        <button
                          type="button"
                          className={`${styles.toggleBtn} ${actShowAll ? styles.toggleBtnActive : ""}`}
                          onClick={() => { setActShowAll(v => !v); setPage(1); }}
                        >
                          {actShowAll ? "Paginar" : "Ver todas"}
                        </button>
                      )}
                    </div>
                  </div>

                  {actLayout === "programas" && (
                    <div className={styles.actProgNav}>
                      <div className={styles.actProgChips}>
                        {progChipLabels.map(prog => {
                          const count = actividades.filter(a => a.programaLabel === prog).length;
                          const isActive = fPrograma === prog;
                          const isOpen = actProgOpen[prog];
                          const color = PROG_COLORS[prog] ?? PIE_COLORS[0];
                          return (
                            <button
                              key={prog}
                              type="button"
                              className={`${styles.actProgChip} ${isActive || isOpen ? styles.actProgChipActive : ""}`}
                              style={{
                                borderColor: isActive || isOpen ? color : undefined,
                                color: isActive || isOpen ? color : undefined,
                                background: isActive || isOpen ? `${color}14` : undefined,
                              }}
                              onClick={() => {
                                setActLayout("programas");
                                if (isActive) {
                                  setFPrograma("Todos");
                                } else {
                                  setFPrograma(prog);
                                  setActProgOpen(prev => ({ ...prev, [prog]: true }));
                                }
                              }}
                            >
                              {prog} <span className={styles.actProgChipCount}>{count}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className={styles.actProgBulk}>
                        <button type="button" className={styles.actProgBulkBtn} onClick={() => {
                          const next: Record<string, boolean> = {};
                          filteredByProg.forEach(([p]) => { next[p] = true; });
                          setActProgOpen(next);
                        }}>Expandir todo</button>
                        <span className={styles.actProgBulkSep}>·</span>
                        <button type="button" className={styles.actProgBulkBtn} onClick={() => setActProgOpen({})}>Colapsar todo</button>
                      </div>
                    </div>
                  )}

                  <div className={`${styles.tableScroll} ${styles.tableScrollTall}`} data-lenis-prevent>
                    {actLayout === "programas" ? (
                      filteredByProg.length === 0 ? (
                        <div className={styles.empty}>No hay actividades con los filtros actuales.</div>
                      ) : (
                        filteredByProg.map(([prog, acts]) => {
                          const isOpen = actProgOpen[prog] ?? false;
                          const progColor = PROG_COLORS[prog] ?? PIE_COLORS[0];
                          const avgCum = Math.round(acts.reduce((s, a) => s + (a.cumplimiento ?? 0), 0) / acts.length);
                          const done = acts.filter(a => (a.cumplimiento ?? 0) >= 100).length;
                          return (
                            <section key={prog} id={`act-prog-${encodeURIComponent(prog)}`} className={styles.actProgSection}>
                              <button
                                type="button"
                                className={styles.actProgHead}
                                onClick={() => toggleProgSection(prog)}
                                aria-expanded={isOpen}
                              >
                                <div className={styles.actProgHeadLeft}>
                                  {isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                                  <span className={styles.actProgDot} style={{ background: progColor }} />
                                  <span className={styles.actProgName}>{prog}</span>
                                  <span className={styles.actProgMeta}>{acts.length} actividades · {done}/{acts.length} al 100%</span>
                                </div>
                                <span className={styles.actProgCumpl} style={{ color: avgCum >= 100 ? "#0ea5e9" : avgCum >= 50 ? "#f57c00" : "#e53935" }}>
                                  {avgCum}% prom.
                                </span>
                              </button>
                              {isOpen && (
                                <div className={styles.actProgBody}>
                                  <table className={`${styles.table} ${actViewFull ? "" : styles.tableCompact}`}>
                                    <ActividadTableHead actViewFull={actViewFull} showPrograma={false} canEdit={canEdit} />
                                    <tbody>
                                      <ActividadRows
                                        acts={acts}
                                        showPrograma={false}
                                        actViewFull={actViewFull}
                                        expandedActId={expandedActId}
                                        highlightActId={highlightActId}
                                        editingActId={editingActId}
                                        helpers={actRowHelpers}
                                      />
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </section>
                          );
                        })
                      )
                    ) : (
                      <table className={`${styles.table} ${actViewFull ? "" : styles.tableCompact}`}>
                        <ActividadTableHead actViewFull={actViewFull} showPrograma canEdit={canEdit} />
                        <tbody>
                          <ActividadRows
                            acts={paginated}
                            showPrograma
                            actViewFull={actViewFull}
                            expandedActId={expandedActId}
                            highlightActId={highlightActId}
                            editingActId={editingActId}
                            helpers={actRowHelpers}
                          />
                        </tbody>
                      </table>
                    )}
                  </div>

                  {actLayout === "lista" && !actShowAll && (
                    <div className={styles.pagination}>
                      <span>Página {page} de {totalPages} · {filtered.length} actividades</span>
                      <button className={styles.pageBtn} disabled={page===1} onClick={()=>setPage(1)}>«</button>
                      <button className={styles.pageBtn} disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button>
                      {Array.from({length:Math.min(5,totalPages)},(_,i)=>Math.max(1,Math.min(totalPages-4,page-2))+i).filter(p=>p<=totalPages).map(p=>(
                        <button key={p} className={`${styles.pageBtn} ${p===page?styles.active:""}`} onClick={()=>setPage(p)}>{p}</button>
                      ))}
                      <button className={styles.pageBtn} disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>›</button>
                      <button className={styles.pageBtn} disabled={page===totalPages} onClick={()=>setPage(totalPages)}>»</button>
                    </div>
                  )}
                  {(actLayout === "programas" || actShowAll) && (
                    <div className={styles.pagination} style={{ justifyContent: "flex-start" }}>
                      <span>
                        {actLayout === "programas"
                          ? `${filtered.length} actividades en ${filteredByProg.length} programas`
                          : `Mostrando las ${paginated.length} actividades${filtered.length !== actividades.length ? " filtradas" : ""}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════ CRONOGRAMA ═══════ */}
            {!loading && !error && activeTab==="cronograma" && (
              <CronogramaPanel
                acts={cronFiltered}
                actividadesAll={actividades}
                totalCount={actividades.length}
                cronSearch={cronSearch}
                setCronSearch={setCronSearch}
                cronFPrograma={cronFPrograma}
                setCronFPrograma={setCronFPrograma}
                cronFResponsable={cronFResponsable}
                setCronFResponsable={setCronFResponsable}
                cronProgOpen={cronProgOpen}
                setCronProgOpen={setCronProgOpen}
                cronHighlightActId={cronHighlightActId}
                programas={programas}
                responsables={responsables}
                currentMonthIdx={currentMonthIdx}
                onJumpAct={jumpToCronAct}
                onGoActividades={goActividadesFromCron}
                onGoCalendario={goCalendarioMonth}
              />
            )}

            {!loading && !error && activeTab === "mantenimientos" && (
              <CalendarioPanel
                acts={calFiltered}
                totalCount={actividades.length}
                calSearch={calSearch}
                setCalSearch={setCalSearch}
                calFPrograma={calFPrograma}
                setCalFPrograma={setCalFPrograma}
                calFResponsable={calFResponsable}
                setCalFResponsable={setCalFResponsable}
                calSelectedMonth={calSelectedMonth}
                setCalSelectedMonth={setCalSelectedMonth}
                programas={programas}
                responsables={responsables}
                currentMonthIdx={currentMonthIdx}
                onGoActividades={goActividadesFromCron}
                onGoPrograma={goProgramaFromCal}
              />
            )}

            {!loading && !error && activeTab === "depreciacion" && (
              <DepreciacionPanel
                acts={deprFiltered}
                sinEquipoCount={sinEquipoCount}
                totalCount={actividades.length}
                deprSearch={deprSearch}
                setDeprSearch={setDeprSearch}
                deprFPrograma={deprFPrograma}
                setDeprFPrograma={setDeprFPrograma}
                deprFEstado={deprFEstado}
                setDeprFEstado={setDeprFEstado}
                programas={programas}
                canEdit={canEdit}
                onEdit={openEdit}
                onGoActividades={() => goTab("actividades")}
              />
            )}

            {!loading && !error && activeTab === "alertas" && (
              <AlertasPanel
                groups={alertGroups}
                highlightActId={activeTab === "alertas" ? highlightActId : null}
                canEdit={canEdit}
                alertSearch={alertSearch}
                setAlertSearch={setAlertSearch}
                alertFPrograma={alertFPrograma}
                setAlertFPrograma={setAlertFPrograma}
                alertFLevel={alertFLevel}
                setAlertFLevel={setAlertFLevel}
                alertFTipo={alertFTipo}
                setAlertFTipo={setAlertFTipo}
                programas={programas}
                onGoActividades={id => goTab("actividades", { actId: id })}
                onGoPrograma={id => goTab("cronograma", { actId: id })}
                onGoPorMes={goAlertPorMes}
                onEdit={openEdit}
              />
            )}
          </div>
        </PageContent>
      </main>
    </div>
  );
}
