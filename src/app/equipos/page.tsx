"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiClock,
  FiRefreshCw,
  FiSearch,
  FiHardDrive,
  FiSmartphone,
  FiWifi,
  FiAlertTriangle,
  FiMapPin,
  FiMonitor,
} from "react-icons/fi";
import { poppins } from "@/fonts";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { resolveItEquiposApi, resolveDataPath } from "@/utils/api";

type TabId = "inventario" | "tipos" | "locales" | "visitas" | "infra";

type Equipo = Record<string, unknown>;

type ItData = {
  lastUpdated?: string;
  source?: string;
  equipos?: Equipo[];
  visitasLocales?: Equipo[];
  infraLocales?: Equipo[];
  resumen?: {
    totalEquipos?: number;
    conCodigo?: number;
    bajas?: number;
    tipos?: Record<string, number>;
    locales?: Record<string, number>;
    marcas?: Record<string, number>;
  };
};

const TABS: { id: TabId; label: string }[] = [
  { id: "inventario", label: "Inventario" },
  { id: "tipos", label: "Por tipo" },
  { id: "locales", label: "Por local" },
  { id: "visitas", label: "Visitas" },
  { id: "infra", label: "Routers / Teléfonos" },
];

function cell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toLocaleString("es-PE", { maximumFractionDigits: 2 });
  }
  return String(v);
}

function formatLastUpdated(iso?: string): string {
  if (!iso) return "Sin sincronizar";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  });
}

function countTipo(tipos: Record<string, number> | undefined, match: RegExp): number {
  if (!tipos) return 0;
  return Object.entries(tipos).reduce((acc, [k, n]) => (match.test(k) ? acc + n : acc), 0);
}

export default function EquiposPage() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();

  const [data, setData] = useState<ItData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("inventario");
  const [query, setQuery] = useState("");
  const [tipoFilter, setTipoFilter] = useState("todos");
  const [localFilter, setLocalFilter] = useState("todos");
  const [selected, setSelected] = useState<Equipo | null>(null);

  const applyPayload = useCallback((payload: ItData) => {
    setData(payload);
    setError(null);
  }, []);

  const loadCached = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = resolveItEquiposApi();
      const res = await fetch(`${api}?action=data`, { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && json.data) {
          applyPayload(json.data as ItData);
          return;
        }
      }
      const staticRes = await fetch(resolveDataPath("/data/it-equipos.json"), { cache: "no-store" });
      if (!staticRes.ok) throw new Error("No hay datos de equipos disponibles");
      applyPayload((await staticRes.json()) as ItData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar equipos");
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  const syncFromOneDrive = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const api = resolveItEquiposApi();
      const res = await fetch(`${api}?action=sync`, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Sync falló (HTTP ${res.status})`);
      }
      applyPayload(json.data as ItData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo sincronizar con OneDrive");
    } finally {
      setSyncing(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadCached();
  }, [loadCached]);

  const equipos = data?.equipos ?? [];
  const visitas = data?.visitasLocales ?? [];
  const infra = data?.infraLocales ?? [];
  const resumen = data?.resumen ?? {};
  const tiposMap = resumen.tipos ?? {};
  const localesMap = resumen.locales ?? {};

  const tipoOptions = useMemo(() => {
    const set = new Set<string>();
    equipos.forEach((e) => {
      const t = String(e["TIPO EQUIPO"] ?? "").trim();
      if (t) set.add(t);
    });
    return ["todos", ...Array.from(set).sort((a, b) => a.localeCompare(b, "es"))];
  }, [equipos]);

  const localOptions = useMemo(() => {
    const set = new Set<string>();
    equipos.forEach((e) => {
      const t = String(e["LOCAL O ÁREA"] ?? "").trim();
      if (t) set.add(t);
    });
    return ["todos", ...Array.from(set).sort((a, b) => a.localeCompare(b, "es"))];
  }, [equipos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return equipos.filter((e) => {
      if (tipoFilter !== "todos" && String(e["TIPO EQUIPO"] ?? "") !== tipoFilter) return false;
      if (localFilter !== "todos" && String(e["LOCAL O ÁREA"] ?? "") !== localFilter) return false;
      if (!q) return true;
      const hay = [
        e["CÓDIGO AF"],
        e["NOMBRES Y APELLIDOS"],
        e["TIPO EQUIPO"],
        e["LOCAL O ÁREA"],
        e["MARCA"],
        e["MODELO"],
        e["NRO SERIE"],
        e["UBICACIÓN"],
        e["OBSERVACIONES"],
      ]
        .map((x) => String(x ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [equipos, query, tipoFilter, localFilter]);

  const tipoBars = useMemo(
    () =>
      Object.entries(tiposMap)
        .map(([label, n]) => ({ label, n }))
        .sort((a, b) => b.n - a.n),
    [tiposMap]
  );
  const localBars = useMemo(
    () =>
      Object.entries(localesMap)
        .map(([label, n]) => ({ label, n }))
        .sort((a, b) => b.n - a.n),
    [localesMap]
  );
  const maxTipo = Math.max(1, ...tipoBars.map((x) => x.n));
  const maxLocal = Math.max(1, ...localBars.map((x) => x.n));

  const kpis = [
    {
      label: "Total equipos",
      value: String(resumen.totalEquipos ?? equipos.length),
      icon: <FiHardDrive />,
    },
    {
      label: "Laptops / PCs",
      value: String(countTipo(tiposMap, /LAPTOP|COMPUTADOR|PC\b/)),
      icon: <FiMonitor />,
    },
    {
      label: "Celulares",
      value: String(countTipo(tiposMap, /CELULAR/)),
      icon: <FiSmartphone />,
    },
    {
      label: "Routers 4G",
      value: String(countTipo(tiposMap, /ROUTER/)),
      icon: <FiWifi />,
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
                <h1>Equipos IT</h1>
                <p>Inventario tecnológico desde OneDrive (BD equipos, visitas e infraestructura).</p>
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
              <div className={styles.loading}>Cargando inventario…</div>
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
                  <span>Con código AF: {cell(resumen.conCodigo)}</span>
                  <span className={styles.warnStat}>
                    <FiAlertTriangle /> Bajas / observación baja: {cell(resumen.bajas)}
                  </span>
                  <span>Locales en infra: {infra.length}</span>
                  <span>Visitas registradas: {visitas.length}</span>
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

                {tab === "inventario" && (
                  <>
                    <div className={styles.filters}>
                      <label className={styles.search}>
                        <FiSearch />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Buscar código, usuario, serie, marca…"
                        />
                      </label>
                      <select
                        className={styles.select}
                        value={tipoFilter}
                        onChange={(e) => setTipoFilter(e.target.value)}
                      >
                        {tipoOptions.map((t) => (
                          <option key={t} value={t}>
                            {t === "todos" ? "Todos los tipos" : t}
                          </option>
                        ))}
                      </select>
                      <select
                        className={styles.select}
                        value={localFilter}
                        onChange={(e) => setLocalFilter(e.target.value)}
                      >
                        {localOptions.map((t) => (
                          <option key={t} value={t}>
                            {t === "todos" ? "Todos los locales" : t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.split}>
                      <section className={styles.panel}>
                        <h2>
                          Equipos <span className={styles.count}>{filtered.length}</span>
                        </h2>
                        <div className={styles.tableWrap}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Tipo</th>
                                <th>Usuario</th>
                                <th>Local</th>
                                <th>Marca / Modelo</th>
                                <th>Serie</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtered.map((e, i) => {
                                const code = cell(e["CÓDIGO AF"]);
                                const isBaja = String(e["OBSERVACIONES"] ?? "")
                                  .toUpperCase()
                                  .includes("BAJA");
                                return (
                                  <tr
                                    key={`${code}-${i}`}
                                    className={`${styles.clickRow} ${selected === e ? styles.rowActive : ""} ${
                                      isBaja ? styles.rowWarn : ""
                                    }`}
                                    onClick={() => setSelected(e)}
                                  >
                                    <td>{code}</td>
                                    <td>{cell(e["TIPO EQUIPO"])}</td>
                                    <td>{cell(e["NOMBRES Y APELLIDOS"])}</td>
                                    <td>{cell(e["LOCAL O ÁREA"])}</td>
                                    <td>
                                      {cell(e["MARCA"])}
                                      {e["MODELO"] ? ` · ${cell(e["MODELO"])}` : ""}
                                    </td>
                                    <td>{cell(e["NRO SERIE"])}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>

                      <aside className={styles.detail}>
                        {selected ? (
                          <>
                            <h2>Detalle</h2>
                            <div className={styles.detailGrid}>
                              {[
                                "CÓDIGO AF",
                                "TIPO EQUIPO",
                                "NOMBRES Y APELLIDOS",
                                "DNI USUARIO",
                                "LOCAL O ÁREA",
                                "CARGO",
                                "UBICACIÓN",
                                "CORREO CORPORATIVO",
                                "MARCA",
                                "MODELO",
                                "PROCESADOR",
                                "NRO SERIE",
                                "SISTEMA OPERATIVO",
                                "DISCO DURO",
                                "RAM",
                                "VERSION OFFICE",
                                "ANTIVIRUS",
                                "ACCESO ID ANYDESK",
                                "CLAVE ANYDESK",
                                "CLAVE ACCESO EQUIPO",
                                "NUMERO CELULAR",
                                "SIM CARD",
                                "VERSION NAVASOFT",
                                "USUARIO NAVASOFT",
                                "OBSERVACIONES",
                                "DATOS ADICIONALES",
                              ].map((key) => (
                                <div key={key} className={styles.detailItem}>
                                  <span>{key}</span>
                                  <strong>{cell(selected[key])}</strong>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className={styles.detailEmpty}>
                            <FiHardDrive />
                            <p>Selecciona un equipo para ver el detalle completo.</p>
                          </div>
                        )}
                      </aside>
                    </div>
                  </>
                )}

                {tab === "tipos" && (
                  <section className={styles.panel}>
                    <h2>
                      <FiHardDrive /> Distribución por tipo
                    </h2>
                    <div className={styles.bars}>
                      {tipoBars.map((a) => (
                        <div key={a.label} className={styles.barRow}>
                          <div className={styles.barLabel}>
                            <strong>{a.label}</strong>
                          </div>
                          <div className={styles.barTrack}>
                            <div className={styles.barFill} style={{ width: `${(a.n / maxTipo) * 100}%` }} />
                          </div>
                          <div className={styles.barValue}>{a.n}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {tab === "locales" && (
                  <section className={styles.panel}>
                    <h2>
                      <FiMapPin /> Distribución por local / área
                    </h2>
                    <div className={styles.bars}>
                      {localBars.map((a) => (
                        <div key={a.label} className={styles.barRow}>
                          <div className={styles.barLabel}>
                            <strong>{a.label}</strong>
                          </div>
                          <div className={styles.barTrack}>
                            <div className={styles.barFill} style={{ width: `${(a.n / maxLocal) * 100}%` }} />
                          </div>
                          <div className={styles.barValue}>{a.n}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {tab === "visitas" && (
                  <section className={styles.panel}>
                    <h2>
                      Visitas a locales <span className={styles.count}>{visitas.length}</span>
                    </h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Local</th>
                            <th>Tipo</th>
                            <th>Marca</th>
                            <th>Modelo</th>
                            <th>Serie</th>
                            <th>AnyDesk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visitas.map((v, i) => (
                            <tr key={i}>
                              <td>{cell(v["CÓDIGO AF"])}</td>
                              <td>{cell(v["LOCAL O ÁREA"])}</td>
                              <td>{cell(v["TIPO EQUIPO"])}</td>
                              <td>{cell(v["MARCA"])}</td>
                              <td>{cell(v["MODELO"])}</td>
                              <td>{cell(v["NRO SERIE"])}</td>
                              <td>{cell(v["ACCESO ID ANYDESK"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {tab === "infra" && (
                  <section className={styles.panel}>
                    <h2>
                      <FiWifi /> Routers y teléfonos por local
                    </h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Local</th>
                            <th>Routers</th>
                            <th>Teléfonos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {infra.map((row, i) => (
                            <tr key={i}>
                              <td>{cell(row["LOCAL"])}</td>
                              <td>{cell(row["ROUTER"])}</td>
                              <td>{cell(row["TELEFONO"])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </PageContent>
      </main>
    </div>
  );
}
