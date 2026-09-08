"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiClock,
  FiUsers,
  FiDollarSign,
  FiRefreshCw,
  FiBriefcase,
  FiMapPin,
  FiFileText,
  FiSearch,
} from "react-icons/fi";
import { poppins } from "@/fonts";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { resolveRrhhApi, resolveDataPath } from "@/utils/api";
import { cell, formatLastUpdated, formatMoney } from "@/utils/tableFormatters";
import { usePageShell } from "@/hooks/usePageShell";

type TabId = "resumen" | "colaboradores" | "directorio" | "areas" | "licencias" | "nomina";

type RrhhData = {
  lastUpdated?: string;
  source?: string;
  resumen?: Record<string, string | number | null>;
  parametrosLegales?: Record<string, unknown>[];
  colaboradores?: Record<string, unknown>[];
  directorio?: Record<string, unknown>[];
  cargos?: Record<string, unknown>[];
  puestos?: Record<string, unknown>[];
  areas?: Record<string, unknown>[];
  licencias?: Record<string, unknown>[];
  comprobantes?: Record<string, unknown>[];
  itemsRemuneracion?: Record<string, unknown>[];
  procesosNomina?: Record<string, unknown>[];
};

const TABS: { id: TabId; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "colaboradores", label: "Colaboradores" },
  { id: "directorio", label: "Directorio" },
  { id: "areas", label: "Áreas" },
  { id: "licencias", label: "Licencias" },
  { id: "nomina", label: "Nómina" },
];


export default function RrhhPage() {
  const { showNotifications, setShowNotifications, showSettings, setShowSettings, darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = usePageShell();

  const [data, setData] = useState<RrhhData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("resumen");
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("todas");

  const applyPayload = useCallback((payload: RrhhData) => {
    setData(payload);
    setError(null);
  }, []);

  const loadCached = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = resolveRrhhApi();
      const res = await fetch(`${api}?action=data`, { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && json.data) {
          applyPayload(json.data as RrhhData);
          return;
        }
      }
      // Fallback: JSON estático exportado
      const staticRes = await fetch(resolveDataPath("/data/rrhh.json"), { cache: "no-store" });
      if (!staticRes.ok) throw new Error("No hay datos RRHH disponibles");
      applyPayload((await staticRes.json()) as RrhhData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar RRHH");
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  const syncFromOneDrive = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const api = resolveRrhhApi();
      const res = await fetch(`${api}?action=sync`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Sync falló (HTTP ${res.status})`);
      }
      applyPayload(json.data as RrhhData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sincronizar con OneDrive");
    } finally {
      setSyncing(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadCached();
  }, [loadCached]);

  const resumen = data?.resumen ?? {};
  const colaboradores = data?.colaboradores ?? [];
  const directorio = data?.directorio ?? [];
  const areas = data?.areas ?? [];
  const licencias = data?.licencias ?? [];
  const procesos = data?.procesosNomina ?? [];
  const comprobantes = data?.comprobantes ?? [];

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    colaboradores.forEach((c) => {
      const a = String(c["Área"] ?? "").trim();
      if (a) set.add(a);
    });
    return ["todas", ...Array.from(set).sort((a, b) => a.localeCompare(b, "es"))];
  }, [colaboradores]);

  const filteredColaboradores = useMemo(() => {
    const q = query.trim().toLowerCase();
    return colaboradores.filter((c) => {
      if (areaFilter !== "todas" && String(c["Área"] ?? "") !== areaFilter) return false;
      if (!q) return true;
      const hay = [c["Nombre"], c["Cargo"], c["Área"], c["Sub-área"], c["Número de Documento"]]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [colaboradores, query, areaFilter]);

  const filteredDirectorio = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return directorio;
    return directorio.filter((c) => {
      const hay = [c["Nombre"], c["Cargo"], c["Área"], c["Email"], c["Teléfono Oficina"]]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [directorio, query]);

  const areaChart = useMemo(() => {
    return [...areas]
      .map((a) => ({
        label: String(a["Sub-área"] ?? a["Área"] ?? "—"),
        area: String(a["Área"] ?? ""),
        n: Number(a["Colaboradores"] ?? 0) || 0,
      }))
      .sort((a, b) => b.n - a.n);
  }, [areas]);

  const maxArea = Math.max(1, ...areaChart.map((a) => a.n));

  const kpis = [
    {
      label: "Colaboradores",
      value: cell(resumen["Total trabajos"] ?? colaboradores.length),
      icon: <FiUsers />,
    },
    {
      label: "Gasto nómina",
      value: cell(resumen["Gasto nómina"]),
      icon: <FiDollarSign />,
    },
    {
      label: "Sueldo mínimo",
      value: cell(resumen["Sueldo Mínimo"]),
      icon: <FiBriefcase />,
    },
    {
      label: "UIT",
      value: cell(resumen["UIT"]),
      icon: <FiFileText />,
    },
  ];

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
          <div className={styles.contentBody}>
            <div className={styles.headerRow}>
              <div className={styles.titleBlock}>
                <h1>Recursos Humanos</h1>
                <p>Indicadores y directorio desde BUK (Excel OneDrive en vivo).</p>
                <span className={styles.subNote}>
                  <FiClock /> Última actualización: {formatLastUpdated(data?.lastUpdated)}
                  {data?.source ? ` · ${data.source}` : ""}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => void loadCached()}
                  disabled={loading || syncing}
                >
                  Recargar
                </button>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => void syncFromOneDrive()}
                  disabled={syncing || loading}
                >
                  <FiRefreshCw className={syncing ? styles.spin : undefined} />
                  {syncing ? "Sincronizando…" : "Actualizar desde OneDrive"}
                </button>
              </div>
            </div>

            {error ? <div className={styles.errorBox}>{error}</div> : null}

            {loading && !data ? (
              <div className={styles.loading}>Cargando RRHH…</div>
            ) : (
              <>
                <div className={styles.kpiGrid}>
                  {kpis.map((k) => (
                    <div key={k.label} className={styles.kpi}>
                      <div className={styles.kpiIcon}>{k.icon}</div>
                      <div>
                        <div className={styles.kpiLabel}>{k.label}</div>
                        <div className={styles.kpiValue}>{k.value}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.miniStats}>
                  <span>Entradas mes: {cell(resumen["Entradas mes"])}</span>
                  <span>Salidas mes: {cell(resumen["Salidas mes"])}</span>
                  <span>Licencias: {cell(resumen["Licencias"] ?? licencias.length)}</span>
                  <span>Permisos: {cell(resumen["Permisos"])}</span>
                  <span>Horas extras: {cell(resumen["Horas extras"])}</span>
                </div>

                <div className={styles.tabs}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {(tab === "colaboradores" || tab === "directorio") && (
                  <div className={styles.filters}>
                    <label className={styles.search}>
                      <FiSearch />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por nombre, cargo, documento…"
                      />
                    </label>
                    {tab === "colaboradores" ? (
                      <select
                        className={styles.select}
                        value={areaFilter}
                        onChange={(e) => setAreaFilter(e.target.value)}
                      >
                        {areaOptions.map((a) => (
                          <option key={a} value={a}>
                            {a === "todas" ? "Todas las áreas" : a}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                )}

                {tab === "resumen" && (
                  <div className={styles.twoCol}>
                    <section className={styles.panel}>
                      <h2>
                        <FiMapPin /> Dotación por sub-área
                      </h2>
                      <div className={styles.bars}>
                        {areaChart.map((a) => (
                          <div key={`${a.area}-${a.label}`} className={styles.barRow}>
                            <div className={styles.barLabel}>
                              <strong>{a.label}</strong>
                              <span>{a.area}</span>
                            </div>
                            <div className={styles.barTrack}>
                              <div className={styles.barFill} style={{ width: `${(a.n / maxArea) * 100}%` }} />
                            </div>
                            <div className={styles.barValue}>{a.n}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className={styles.panel}>
                      <h2>
                        <FiBriefcase /> Procesos de nómina
                      </h2>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Periodo</th>
                              <th>Estado</th>
                              <th>Inicio</th>
                              <th>Término</th>
                            </tr>
                          </thead>
                          <tbody>
                            {procesos.map((p, i) => (
                              <tr key={i}>
                                <td>{cell(p["Periodo"])}</td>
                                <td>
                                  <span
                                    className={`${styles.pill} ${
                                      String(p["Estado del periodo"]).toLowerCase().includes("abierto")
                                        ? styles.pillOpen
                                        : styles.pillClosed
                                    }`}
                                  >
                                    {cell(p["Estado del periodo"])}
                                  </span>
                                </td>
                                <td>{cell(p["Fecha de inicio"])}</td>
                                <td>{cell(p["Fecha de término"])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}

                {tab === "colaboradores" && (
                  <section className={styles.panel}>
                    <h2>
                      Colaboradores <span className={styles.count}>{filteredColaboradores.length}</span>
                    </h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Nombre</th>
                            <th>Documento</th>
                            <th>Cargo</th>
                            <th>Área</th>
                            <th>Sub-área</th>
                            <th>Ingreso</th>
                            <th>Sueldo neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredColaboradores.map((c, i) => (
                            <tr key={i}>
                              <td>{cell(c["Nombre"])}</td>
                              <td>{cell(c["Número de Documento"])}</td>
                              <td>{cell(c["Cargo"])}</td>
                              <td>{cell(c["Área"])}</td>
                              <td>{cell(c["Sub-área"])}</td>
                              <td>{cell(c["Fecha Ingreso"])}</td>
                              <td>{formatMoney(c["Sueldo Neto"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {tab === "directorio" && (
                  <section className={styles.panel}>
                    <h2>
                      Directorio <span className={styles.count}>{filteredDirectorio.length}</span>
                    </h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Nombre</th>
                            <th>Cargo</th>
                            <th>Área</th>
                            <th>Teléfono</th>
                            <th>Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDirectorio.map((c, i) => (
                            <tr key={i}>
                              <td>{cell(c["Nombre"])}</td>
                              <td>{cell(c["Cargo"])}</td>
                              <td>{cell(c["Área"])}</td>
                              <td>{cell(c["Teléfono Oficina"])}</td>
                              <td>{cell(c["Email"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {tab === "areas" && (
                  <section className={styles.panel}>
                    <h2>Áreas y sub-áreas</h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>División</th>
                            <th>Área</th>
                            <th>Sub-área</th>
                            <th>Colaboradores</th>
                          </tr>
                        </thead>
                        <tbody>
                          {areas.map((a, i) => (
                            <tr key={i}>
                              <td>{cell(a["División"])}</td>
                              <td>{cell(a["Área"])}</td>
                              <td>{cell(a["Sub-área"])}</td>
                              <td>{cell(a["Colaboradores"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {tab === "licencias" && (
                  <section className={styles.panel}>
                    <h2>
                      Licencias <span className={styles.count}>{licencias.length}</span>
                    </h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Colaborador</th>
                            <th>Tipo</th>
                            <th>Inicio</th>
                            <th>Duración</th>
                            <th>Plan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {licencias.map((l, i) => (
                            <tr key={i}>
                              <td>{cell(l["ID"])}</td>
                              <td>{cell(l["Colaborador"])}</td>
                              <td>{cell(l["Tipo de Licencia"])}</td>
                              <td>{cell(l["Fecha Inicio"])}</td>
                              <td>{cell(l["Duración"])}</td>
                              <td>{cell(l["Plan de Salud"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {tab === "nomina" && (
                  <div className={styles.twoCol}>
                    <section className={styles.panel}>
                      <h2>Procesos</h2>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Periodo</th>
                              <th>Estado</th>
                              <th>Procesos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {procesos.map((p, i) => (
                              <tr key={i}>
                                <td>{cell(p["Periodo"])}</td>
                                <td>{cell(p["Estado del periodo"])}</td>
                                <td>{cell(p["Número de procesos"])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    <section className={styles.panel}>
                      <h2>
                        Comprobantes recientes <span className={styles.count}>{Math.min(50, comprobantes.length)}</span>
                      </h2>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Nombre</th>
                              <th>Periodo</th>
                              <th>Neto</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comprobantes.slice(0, 50).map((c, i) => (
                              <tr key={i}>
                                <td>{cell(c["Nombre"])}</td>
                                <td>{cell(c["Periodo"])}</td>
                                <td>{formatMoney(c["Neto a Pagar"])}</td>
                                <td>{cell(c["Estado"])}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )}
          </div>
        </PageContent>
      </main>
    </div>
  );
}
