"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import pageStyles from "../page.module.css";
import { poppins } from "@/fonts";
import { FiMove } from "react-icons/fi";
import styles from "./page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { useTicketsContext } from "@/contexts/TicketsContext";

const CHART_IDS = ["volumen", "estado", "contacto", "owner", "motivo", "resueltos"] as const;
type ChartId = (typeof CHART_IDS)[number];

const motiveColors = ["#0EA5E9", "#6366F1", "#EC4899", "#F97316", "#10B981", "#FACC15", "#14B8A6", "#A855F7"];

const normalizeEstadoValue = (value: unknown) =>
  `${value ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const isConSolucionEstado = (value: unknown) => normalizeEstadoValue(value) === "con solucion";

const sanitizeChartOrder = (raw: unknown): ChartId[] => {
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized: ChartId[] = [];
  incoming.forEach((item) => {
    if (typeof item !== "string") return;
    const mapped = item === "dias" ? "motivo" : item;
    if ((CHART_IDS as readonly string[]).includes(mapped) && !normalized.includes(mapped as ChartId)) {
      normalized.push(mapped as ChartId);
    }
  });
  CHART_IDS.forEach((id) => {
    if (!normalized.includes(id)) normalized.push(id);
  });
  return normalized;
};
export default function AnalisisPage() {
  const { tickets } = useTicketsContext();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();
  const compactDefaultOrder: ChartId[] = [...CHART_IDS];
  const [chartOrder, setChartOrder] = useState<ChartId[]>(() => {
    if (typeof window === "undefined") return compactDefaultOrder;
    try {
      const saved = window.localStorage.getItem("chart-order");
      if (saved) {
        const parsed = JSON.parse(saved);
        return sanitizeChartOrder(parsed);
      }
    } catch {
      // ignore
    }
    return compactDefaultOrder;
  });
  const [dragging, setDragging] = useState<ChartId | null>(null);
  const lastHover = useRef<ChartId | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("chart-order", JSON.stringify(chartOrder));
  }, [chartOrder]);


  const handleDragStart = (id: ChartId) => (e: DragEvent) => {
    setDragging(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    const card = (e.currentTarget as HTMLElement)?.closest(`.${styles.chartCard}`) as HTMLElement | null;
    if (card) {
      const rect = card.getBoundingClientRect();
      e.dataTransfer.setDragImage(card, rect.width / 2, 20);
    }
  };

  const reorderCharts = (sourceId: ChartId, targetId: ChartId, prev: ChartId[]) => {
    if (sourceId === targetId) return prev;
    const next = [...prev];
    const from = next.indexOf(sourceId);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return prev;
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    return next;
  };

  const handleDragOver = (targetId: ChartId) => (e: DragEvent) => {
    if (!dragging || dragging === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (lastHover.current === targetId) return;
    lastHover.current = targetId;
    setChartOrder((prev: ChartId[]) => {
      const next = reorderCharts(dragging, targetId, prev);
      if (next === prev || next.join("|") === prev.join("|")) return prev;
      return next;
    });
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(null);
    lastHover.current = null;
  };

  const handleDragEnd = () => {
    setDragging(null);
    lastHover.current = null;
  };

  const stats = useMemo(() => {
    if (!tickets.length) return null;
    const parsed = tickets.map((t) => {
      const estadoRaw = (t.Estado || "sin estado").toString();
      const estado = estadoRaw.toLowerCase();
      const alta = t["F. Alta"] ? new Date(t["F. Alta"]) : null;
      const altaValid = alta && !Number.isNaN(alta.getTime()) ? alta : null;
      const dias = typeof t["Días"] === "number" ? t["Días"] : Number(t["Días"] ?? 0);
      const contacto = t["Contacto"] || "Sin contacto";
      const owner = t["Usuario a Cargo"] || "Sin asignar";
      const motivoRaw = (t.Motivo ?? t["motivo"] ?? "Sin motivo").toString();
      const motivo = motivoRaw.trim() ? motivoRaw : "Sin motivo";
      return { estado, estadoRaw, alta: altaValid, dias, contacto, owner, motivo };
    });

    // Mes
    const byMonth: { label: string; creados: number; solucionados: number }[] = [];
    const mapMonth: Record<string, { creados: number; solucionados: number }> = {};
    parsed.forEach((t) => {
      if (!t.alta) return;
      const key = `${t.alta.getFullYear()}-${String(t.alta.getMonth() + 1).padStart(2, "0")}`;
      if (!mapMonth[key]) mapMonth[key] = { creados: 0, solucionados: 0 };
      mapMonth[key].creados += 1;
      if (isConSolucionEstado(t.estadoRaw)) mapMonth[key].solucionados += 1;
    });
    Object.entries(mapMonth)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .forEach(([label, value]) => byMonth.push({ label, ...value }));

    // Estado
    const byEstadoMap: Record<string, number> = {};
    parsed.forEach((t) => {
      byEstadoMap[t.estado] = (byEstadoMap[t.estado] || 0) + 1;
    });
    const byEstado = Object.entries(byEstadoMap).map(([label, value]) => ({ label, value }));

    // Contacto top
    const byContactoMap: Record<string, number> = {};
    parsed.forEach((t) => {
      byContactoMap[t.contacto] = (byContactoMap[t.contacto] || 0) + 1;
    });
    const byContacto = Object.entries(byContactoMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));

    // Owner top
    const byOwnerMap: Record<string, number> = {};
    parsed.forEach((t) => {
      byOwnerMap[t.owner] = (byOwnerMap[t.owner] || 0) + 1;
    });
    const byOwner = Object.entries(byOwnerMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));

    // Motivo
    const byMotivoMap: Record<string, number> = {};
    parsed.forEach((t) => {
      const label = t.motivo || "Sin motivo";
      byMotivoMap[label] = (byMotivoMap[label] || 0) + 1;
    });
    const byMotivo = Object.entries(byMotivoMap)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));

    // Serie diaria últimos 30 días
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    const byDayMap: Record<string, number> = {};
    parsed.forEach((t) => {
      if (!t.alta) return;
      if (t.alta < start) return;
      const key = t.alta.toISOString().slice(0, 10);
      byDayMap[key] = (byDayMap[key] || 0) + 1;
    });
    const byDay: { label: string; value: number }[] = [];
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      byDay.push({ label: key, value: byDayMap[key] ?? 0 });
    }

    const totalSolved = parsed.filter((t) => isConSolucionEstado(t.estadoRaw)).length;
    const resolutionRate = tickets.length ? (totalSolved / tickets.length) * 100 : 0;

    return { byMonth, byEstado, byContacto, byOwner, byMotivo, byDay, resolutionRate, total: tickets.length, solved: totalSolved };
  }, [tickets]);

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
          <div className={styles.mainScroll}>
            {!stats ? (
              <div className={styles.loading}>Cargando analíticas…</div>
            ) : (
              <div className={styles.chartsGrid}>
              {chartOrder.map((id) => {
                if (id === "volumen") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <div>
                          <h4>Volumen mensual</h4>
                          <p>Tickets creados vs solucionados</p>
                        </div>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={stats.byMonth}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis dataKey="label" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} />
                          <YAxis stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} allowDecimals={false} />
                          <Tooltip />
                          <Area type="monotone" dataKey="creados" stroke="#4C6FFF" fill="#4C6FFF22" />
                          <Area type="monotone" dataKey="solucionados" stroke="#00B894" fill="#00B89422" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                if (id === "estado") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <h4>Distribución por estado</h4>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.byEstado}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis dataKey="label" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} />
                          <YAxis stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="value" fill="#0EA5E9" radius={[6,6,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                if (id === "contacto") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <h4>Contactos (top 8)</h4>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.byContacto} layout="vertical" barSize={16}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis type="number" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} />
                          <YAxis type="category" dataKey="label" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} width={150} />
                          <Tooltip />
                          <Bar dataKey="value" fill="#F4B000" radius={[0,8,8,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                if (id === "owner") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <h4>Usuarios a cargo (top 8)</h4>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.byOwner} layout="vertical" barSize={16}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis type="number" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} />
                          <YAxis type="category" dataKey="label" stroke="#6B7280" tick={{ fill: "#6B7280", fontSize: 11 }} width={150} />
                          <Tooltip />
                          <Bar dataKey="value" fill="#4C6FFF" radius={[0,8,8,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                if (id === "motivo") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <div>
                          <h4>Distribución por motivo</h4>
                          <p>Participación de solicitudes por motivo declarado</p>
                        </div>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                          <Pie
                            data={stats.byMotivo}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={40}
                            outerRadius={70}
                            paddingAngle={3}
                            label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`}
                          >
                            {stats.byMotivo.map((entry, index) => (
                              <Cell key={entry.label} fill={motiveColors[index % motiveColors.length]} />
                            ))}
                          </Pie>
                          <Legend verticalAlign="bottom" height={36} />
                          <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                if (id === "resueltos") {
                  return (
                    <div
                      key={id}
                      className={`${styles.chartCard} ${dragging === id ? styles.cardDragging : ""}`}
                      onDragOver={handleDragOver(id)}
                      onDrop={handleDrop}
                    >
                      <div className={styles.cardHeaderRow}>
                        <h4>Resueltos vs pendientes</h4>
                        <div
                          className={styles.dragHandle}
                          title="Arrastra para reordenar"
                          draggable
                          onDragStart={handleDragStart(id)}
                          onDragEnd={handleDragEnd}
                        >
                          <FiMove />
                        </div>
                      </div>
                      <div className={styles.chartContent}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                          <Pie
                            data={[{ name: "Solucionados", value: stats.solved }, { name: "Pendientes/otros", value: stats.total - stats.solved }]}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={46}
                            outerRadius={70}
                            paddingAngle={2}
                          >
                            <Cell fill="#00B894" />
                            <Cell fill="#6C5CE7" />
                          </Pie>
                          <Legend />
                          <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                }
                return null;
              })}
              </div>
            )}
          </div>
        </PageContent>
      </main>
    </div>
  );
}
