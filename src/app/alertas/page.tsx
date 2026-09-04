"use client";

import { FiAlertTriangle, FiClock } from "react-icons/fi";
import { poppins } from "@/fonts";
import styles from "./page.module.css";
import pageStyles from "../page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { useSlaAlerts } from "@/hooks/useSlaAlerts";
import { SLA_SEVERITY_COPY, type SlaSeverity } from "@/utils/slaAlerts";
import { useState } from "react";

export default function AlertasPage() {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { darkMode, setDarkMode, sidebarRight, setSidebarRight, collapsed, setCollapsed } = useUiPrefs();
  const { alerts, loading } = useSlaAlerts(20);

  const badgeClass = (severity: SlaSeverity) => {
    if (severity === "critico") return styles.critico;
    if (severity === "alta") return styles.alta;
    if (severity === "media") return styles.media;
    return styles.baja;
  };

  return (
    <div
      className={`${pageStyles.page} ${poppins.className} ${collapsed ? pageStyles.collapsed : ""} ${darkMode ? pageStyles.dark : ""} ${
        sidebarRight ? pageStyles.sidebarRight : ""
      }`}
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
                <h1>Alertas</h1>
                <p>Monitorea incidentes y prioridades en tiempo casi real.</p>
                <span className={styles.subNote}>Basado en tickets pendientes sin fecha de respuesta real.</span>
              </div>
              <div className={styles.metaRow}>
                <div className={styles.chip}>
                  <FiAlertTriangle /> Priorizadas por urgencia
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.loading}>Cargando alertas…</div>
            ) : alerts.length === 0 ? (
              <div className={styles.empty}>No hay tickets pendientes que generen alertas SLA.</div>
            ) : (
              <div className={styles.alertGrid}>
                {alerts.map((alert) => (
                  <div key={alert.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={`${styles.badge} ${badgeClass(alert.severity)}`}>
                        <FiAlertTriangle /> {alert.severity.toUpperCase()}
                      </div>
                      <h3>{alert.title}</h3>
                    </div>
                    <p className={styles.description}>{alert.description}</p>
                    <p className={styles.helperCopy}>{SLA_SEVERITY_COPY[alert.severity]}</p>
                    <div className={styles.metaRow}>
                      <span>
                        <FiClock /> Abierto hace {Math.max(1, Math.floor(alert.minutesAgo / 60))} h aprox.
                      </span>
                      <span>{alert.source}</span>
                    </div>
                    {alert.tags?.length ? (
                      <div className={styles.chips}>
                        {alert.tags.map((tag) => (
                          <span key={tag} className={styles.chip}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </PageContent>
      </main>
    </div>
  );
}
