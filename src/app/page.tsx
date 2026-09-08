"use client";

import { useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import { resolveTicketsApi } from "@/utils/api";
import { useTicketsContext, type TicketRecord } from "@/contexts/TicketsContext";
import {
  FiEdit2,
  FiTrash2,
  FiCheckCircle,
  FiXCircle,
  FiAlertTriangle,
} from "react-icons/fi";
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { poppins } from "@/fonts";
import styles from "./page.module.css";
import { Sidebar } from "../components/Sidebar";
import { Header } from "../components/Header";
import { PageContent } from "../components/PageContent";
import { EmptyState } from "../components/EmptyState";
import { usePageShell } from "@/hooks/usePageShell";
const API = resolveTicketsApi();
const SNACKBAR_DURATION = 4500;

type RangeOption = "1d" | "7d" | "30d" | "90d" | "all";

type Ticket = TicketRecord;
type EstadoCategory = "solucionado" | "pendiente" | "sin_estado" | "otro";

type ParsedTicket = Ticket & {
  alta: Date | null;
  registro: Date | null;
  dias: number | null;
  estado: string;
  estadoNorm: string;
  estadoCategory: EstadoCategory;
};

type SnackbarTone = "success" | "error" | "warning";
type Snackbar = { id: number; message: string; tone: SnackbarTone; duration: number };

type ChartPoint = { label: string; value: number };

const palette = {
  primary: "#2F80ED",
  primaryDark: "#1C5DB6",
  primaryLight: "#5AA9FF",
  accent: "#F4B000",
  background: "#EEF3F8",
  cardWhite: "#FFFFFF",
  textPrimary: "#1F2937",
  textSecondary: "#6B7280",
  borderGray: "#D1D5DB",
};

const normalizeEstadoValue = (value: unknown) =>
  `${value ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const isConSolucionEstado = (value: unknown) => normalizeEstadoValue(value) === "con solucion";

const isCerradoEstado = (value: unknown) => /cerrad/.test(normalizeEstadoValue(value));

const categorizeEstado = (estadoNorm: string): EstadoCategory => {
  const cleaned = estadoNorm.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.includes("sin estado")) return "sin_estado";
  if (/(solucion|resuelt|cerrad|finaliz|complet|terminad)/.test(cleaned)) return "solucionado";
  if (/(pend|desarrollo|curso|abiert|proceso|asignad|activo|espera|gest|trabaj|analisis|revision|sin resolver|no resuelto)/.test(cleaned)) {
    return "pendiente";
  }
  return "pendiente";
};

export default function Home() {
  const { tickets, setTickets } = useTicketsContext();
  const [form, setForm] = useState<Partial<Ticket>>({ Estado: "pendiente", "Usuario a Cargo": "Sin asignar" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Ticket | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [snackbars, setSnackbars] = useState<Snackbar[]>([]);
  const snackbarIdRef = useRef(0);

  const snackbarIcons: Record<SnackbarTone, ReactNode> = {
    success: <FiCheckCircle />,
    error: <FiXCircle />,
    warning: <FiAlertTriangle />,
  };

  const showSnackbar = (message: string, tone: SnackbarTone, duration = SNACKBAR_DURATION) => {
    const id = snackbarIdRef.current++;
    setSnackbars((prev) => [...prev, { id, message, tone, duration }]);
    setTimeout(() => {
      setSnackbars((prev) => prev.filter((snack) => snack.id !== id));
    }, duration);
  };

  const { showNotifications, setShowNotifications, showSettings, setShowSettings, darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = usePageShell();
  const [range, setRange] = useState<RangeOption>("30d");

  const persist = useCallback((next: Ticket[]) => {
    setTickets(next);
  }, [setTickets]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.Incidencia || !form["Nº ticket"]) return;
    const base: Ticket = {
      Incidencia: form.Incidencia,
      "Nº ticket": Number(form["Nº ticket"]),
      Estado: form.Estado || "sin estado",
      "Usuario a Cargo": form["Usuario a Cargo"] || "Sin asignar",
      Contacto: form.Contacto || "Sin contacto",
      Solución: form.Solución || "No registrado",
      "F. Alta": form["F. Alta"] || new Date().toISOString(),
      "F. Registro": form["F. Registro"] || new Date().toISOString(),
      "Días": form["Días"] ? Number(form["Días"]) : 0,
    };
    if (editingId === null && tickets.some((ticket) => Number(ticket["Nº ticket"]) === base["Nº ticket"])) {
      showSnackbar(`El Nº ticket ${base["Nº ticket"]} ya existe`, "warning");
      return;
    }
    const payload = { ...base, "Nº ticket": editingId ?? base["Nº ticket"] };
    try {
      const res = await fetch(API, {
        method: editingId !== null ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        showSnackbar(`El Nº ticket ${payload["Nº ticket"]} ya existe`, "warning");
        return;
      }
      if (!res.ok) throw new Error("No se pudo guardar el ticket");
      const data = await res.json();
      persist(data);
      setForm({ Estado: "pendiente", "Usuario a Cargo": "Sin asignar" });
      if (editingId !== null) {
        setShowEditModal(false);
        setEditingId(null);
        showSnackbar("Ticket actualizado", "success");
      } else {
        showSnackbar("Ticket registrado", "success");
      }
    } catch (err) {
      console.error(err);
      showSnackbar("No se pudo guardar el ticket", "error");
    }
  };

  const startEdit = (t: Ticket) => {
    setEditingId(t["Nº ticket"] ?? null);
    setForm(t);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingId(null);
    setForm({ Estado: "pendiente", "Usuario a Cargo": "Sin asignar" });
  };

  const handleDelete = async (id?: number | string) => {
    const safeId = id !== undefined && id !== null && `${id}` !== "" ? id : undefined;
    if (safeId === undefined) return false;
    try {
      const res = await fetch(`${API}?id=${encodeURIComponent(safeId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("No se pudo eliminar el ticket");
      const data = await res.json();
      persist(data);
      if (editingId === id) {
        closeEditModal();
      }
      showSnackbar("Ticket eliminado", "error");
      return true;
    } catch (err) {
      console.error(err);
      showSnackbar("No se pudo eliminar el ticket", "error");
      return false;
    }
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

  const formatDate = useCallback((value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }, []);

  const parsed = useMemo<ParsedTicket[]>(() => {
    return tickets.map((t) => {
      const estado = (t.Estado || "sin estado").toString();
      const estadoNorm = normalizeEstadoValue(estado);
      return {
        ...t,
        alta: t["F. Alta"] ? new Date(t["F. Alta"]!) : null,
        registro: t["F. Registro"] ? new Date(t["F. Registro"]!) : null,
        dias: typeof t["Días"] === "number" ? t["Días"]! : null,
        estado,
        estadoNorm,
        estadoCategory: categorizeEstado(estadoNorm),
      };
    });
  }, [tickets]);

  const stats = useMemo(() => {
    if (!parsed.length) return null;
    const total = parsed.length;
    const solved = parsed.filter((t) => isConSolucionEstado(t.estado)).length;
    const cerrado = parsed.filter((t) => isCerradoEstado(t.estado)).length;
    const pending = parsed.filter((t) => !isConSolucionEstado(t.estado) && !isCerradoEstado(t.estado)).length;
    const avgDays = parsed.reduce((sum, t) => sum + (t.dias ?? 0), 0) / total;

    const byStatusMap: Record<string, number> = {};
    parsed.forEach((t) => {
      byStatusMap[t.estado] = (byStatusMap[t.estado] || 0) + 1;
    });
    const byStatus: ChartPoint[] = Object.entries(byStatusMap).map(([label, value]) => ({ label, value }));

    const byMonthMap: Record<string, number> = {};
    parsed.forEach((t) => {
      if (!t.alta) return;
      const key = `${t.alta.getFullYear()}-${String(t.alta.getMonth() + 1).padStart(2, "0")}`;
      byMonthMap[key] = (byMonthMap[key] || 0) + 1;
    });
    const byMonth: ChartPoint[] = Object.entries(byMonthMap)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([label, value]) => ({ label, value }));

    return { total, solved, pending, cerrado, avgDays, byStatus, byMonth };
  }, [parsed]);

  const timeSeries = useMemo(() => {
    if (!stats) return [] as { label: string; creados: number; solucionados: number }[];
    const days = range === "all" ? Infinity : range === "1d" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const now = new Date();
    const map: Record<string, { creados: number; solucionados: number }> = {};

    parsed.forEach((t) => {
      const d = t.alta;
      if (!d || Number.isNaN(d.getTime())) return;
      const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      if (days !== Infinity && diff > days) return;
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { creados: 0, solucionados: 0 };
      map[key].creados += 1;
      if (isConSolucionEstado(t.estado)) map[key].solucionados += 1;
    });

    const keys = Object.keys(map).sort();

    const startDate = (() => {
      if (days === Infinity) return keys.length ? new Date(keys[0]) : new Date(now);
      const d = new Date(now);
      d.setDate(d.getDate() - (days - 1));
      return d;
    })();

    const result: { label: string; creados: number; solucionados: number }[] = [];
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      result.push({ label: key, ...(map[key] ?? { creados: 0, solucionados: 0 }) });
    }
    return result;
  }, [parsed, range, stats]);

  return (
    <div
      className={`${styles.page} ${poppins.className} ${collapsed ? styles.collapsed : ""} ${darkMode ? styles.dark : ""} ${
        sidebarRight ? styles.sidebarRight : ""
      }`}
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
          {!stats ? (
          <div className={styles.loading}>Cargando tickets…</div>
        ) : (
          <>
            <section className={styles.chartsRow}>
              <div className={styles.leftColumn}>
                <div className={styles.statsPanel}>
                  <div className={styles.statsGrid}> 
                    <StatCard label="Total" value={stats.total} color={palette.primary} />
                    <StatCard label="Solucionados" value={stats.solved} color={palette.primaryLight} />
                    <StatCard label="Pendientes" value={stats.pending} color={palette.primaryDark} />
                    <StatCard label="Cerrado" value={stats.cerrado} color={palette.textSecondary} />
                  </div>
                </div>
                <div className={styles.percentPanel}>
                  <div className={styles.percentTitle}>Porcentajes</div>
                  <div className={styles.percentRows}>
                    <div className={styles.percentRow}>
                      <span>Solucionados</span>
                      <strong>{((stats.solved / stats.total) * 100 || 0).toFixed(1)}%</strong>
                    </div>
                    <div className={styles.percentRow}>
                      <span>Pendientes</span>
                      <strong>{((stats.pending / stats.total) * 100 || 0).toFixed(1)}%</strong>
                    </div>
                    <div className={styles.percentRow}>
                      <span>Cerrado</span>
                      <strong>{((stats.cerrado / stats.total) * 100 || 0).toFixed(1)}%</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <div className={styles.panelTitleRow}>
                    <div className={styles.rangeSwitch}>
                      {(["1d", "7d", "30d", "90d", "all"] as RangeOption[]).map((r) => (
                        <button
                          key={r}
                          className={`${styles.rangeItem} ${range === r ? styles.rangeActive : ""}`}
                          onClick={() => setRange(r)}
                        >
                          {r === "all" ? "Todo" : `${r.replace("d", "")}D`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className={styles.chartWrap}>
                  {timeSeries.length === 0 ? (
                    <div className={styles.emptyState}>Sin datos en el rango seleccionado.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={380}>
                      <LineChart data={timeSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="label" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                        <YAxis stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D1D5DB" }} />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="creados"
                          stroke={palette.primary}
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          isAnimationActive
                          animationDuration={400}
                        />
                        <Line
                          type="monotone"
                          dataKey="solucionados"
                          stroke={palette.accent}
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6 }}
                          isAnimationActive
                          animationDuration={400}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </section>

            <section className={styles.tableSection}>
              <div className={styles.panelHead}>
                <h3>Tickets recientes</h3>
              </div>
              <div className={styles.tableWrap}>
                {parsed.length === 0 ? (
                  <EmptyState
                    title="Aún no hay tickets"
                    description="Cuando existan registros, los últimos aparecerán aquí. Usa el formulario superior para crear el primero."
                    compact
                  />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>N°</th>
                        <th>Incidencia</th>
                        <th>Estado</th>
                        <th>Asignado</th>
                        <th>Días</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 8).map((t, idx) => (
                        <tr key={`${t["Nº ticket"]}-${idx}`}>
                          <td>{t["Nº ticket"] ?? "-"}</td>
                          <td className={styles.incidencia}>{t.Incidencia}</td>
                          <td>
                            <span className={`${styles.badgeSmall} ${statusClass(t.estado)}`}>
                              {t.Estado || "Sin estado"}
                            </span>
                          </td>
                          <td>{t["Usuario a Cargo"] || "Sin asignar"}</td>
                          <td>{t.dias ?? "-"}</td>
                          <td className={styles.actionsCell}>
                            <button className={styles.iconBtn} onClick={() => startEdit(t)} aria-label="Editar">
                              <FiEdit2 />
                            </button>
                            <button className={`${styles.iconBtn} ${styles.iconDanger}`} onClick={() => requestDelete(t)} aria-label="Eliminar">
                              <FiTrash2 />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </>
        )}
        </PageContent>
      </main>

      {showEditModal && editingId !== null && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label={`Editar ticket ${editingId}`}>
            <div className={styles.modalHeader}>
              <div>
                <h4>Actualiza el estado y la solución registrada.</h4>
                <p>Sincroniza la información con el equipo de soporte.</p>
              </div>
              <button type="button" className={styles.modalClose} onClick={closeEditModal} aria-label="Cerrar">
                ×
              </button>
            </div>
            <div className={styles.modalStats}>
              {[{ label: "Nº ticket", value: `#${form["Nº ticket"] ?? "—"}` },
                { label: "Días abiertos", value: form["Días"] ?? 0 },
                { label: "F. registro", value: formatDate(form["F. Registro"]) },
                { label: "F. alta", value: formatDate(form["F. Alta"]) },
              ].map((stat) => (
                <div key={stat.label} className={styles.modalStatCard}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
            <div className={styles.modalBodyGrid}>
              <form className={styles.modalForm} onSubmit={handleSubmit}>
                <label>
                  <span>Estado</span>
                  <select value={form.Estado ?? "sin estado"} onChange={(e) => setForm((prev) => ({ ...prev, Estado: e.target.value }))}>
                    <option value="pendiente">Pendiente</option>
                    <option value="en desarrollo">En desarrollo</option>
                    <option value="solucionado">Solucionado</option>
                    <option value="sin estado">Sin estado</option>
                  </select>
                </label>
                <label className={styles.modalTextareaLabel}>
                  <span>Solución / Comentarios</span>
                  <textarea
                    rows={8}
                    value={form.Solución ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, Solución: e.target.value }))}
                    placeholder="Describe la acción tomada"
                  />
                </label>
                <div className={styles.modalActions}>
                  <button type="button" className={styles.btnGhost} onClick={closeEditModal}>
                    Cancelar
                  </button>
                  <button type="submit" className={styles.btnPrimary}>Guardar cambios</button>
                </div>
              </form>
              <div className={styles.modalDetails}>
                <div className={styles.modalDetailBlock}>
                  <span>Incidencia</span>
                  <p>{form.Incidencia || "Sin descripción"}</p>
                </div>
                <div className={styles.modalDetailGrid}>
                  <div className={styles.modalDetailBlock}>
                    <span>Asignado</span>
                    <p>{form["Usuario a Cargo"] || "Sin asignar"}</p>
                  </div>
                  <div className={styles.modalDetailBlock}>
                    <span>Contacto</span>
                    <p>{form.Contacto || "Sin contacto"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className={styles.modalOverlay}>
          <div className={styles.confirmCard} role="dialog" aria-modal="true" aria-label="Confirmar eliminación">
            <h3 className={styles.confirmTitle}>
              ¿Eliminar ticket{" "}
              {pendingDelete["Nº ticket"] != null
                ? `#${pendingDelete["Nº ticket"]}`
                : `«${String(pendingDelete.Incidencia || pendingDelete["_dbId"] || "sin número").slice(0, 30)}»`}
              ?
            </h3>
            <p className={styles.confirmText}>Esta acción no se puede deshacer. Confirma si deseas eliminarlo definitivamente.</p>
            <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={cancelDelete} disabled={deleteLoading}>
                Cancelar
              </button>
              <button type="button" className={styles.confirmDelete} onClick={confirmDelete} disabled={deleteLoading}>
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
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={styles.statCard} style={{ borderColor: color }}>
      <p>{label}</p>
      <h2 style={{ color }}>{value}</h2>
    </div>
  );
}

function statusClass(estado: string | undefined | null) {
  if (!estado) return styles.statusNeutral;
  const norm = normalizeEstadoValue(estado);
  const category = categorizeEstado(norm);
  if (category === "solucionado") return styles.statusGood;
  if (category === "pendiente") return styles.statusWarn;
  if (category === "sin_estado") return styles.statusNeutral;
  return styles.statusNeutral;
}
