"use client";

import { useEffect, useRef, useState } from "react";
import { poppins } from "@/fonts";
import pageStyles from "../page.module.css";
import styles from "./page.module.css";
import { Sidebar } from "../../components/Sidebar";
import { Header } from "../../components/Header";
import { PageContent } from "../../components/PageContent";
import { useUiPrefs } from "@/contexts/UiPrefsContext";
import { useAuthSession } from "@/components/AuthGate";
import {
  ManualChapter,
  type ManualSectionId,
  isManualSectionId,
  isManualSectionVisibleForRole,
  manualTocEntriesForRole,
} from "./manualSections";

export default function DocsPage() {
  const auth = useAuthSession();
  const { collapsed, setCollapsed, darkMode, setDarkMode, sidebarRight, setSidebarRight } = useUiPrefs();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [activeSection, setActiveSection] = useState<ManualSectionId>("manual-intro");
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewerRef.current?.scrollTo(0, 0);
  }, [activeSection]);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw || !isManualSectionId(raw)) return;
    if (isManualSectionVisibleForRole(raw, auth.role)) {
      setActiveSection(raw);
    } else {
      window.history.replaceState(null, "", "#manual-intro");
    }
  }, [auth.role]);

  useEffect(() => {
    if (!isManualSectionVisibleForRole(activeSection, auth.role)) {
      const fallback = manualTocEntriesForRole(auth.role)[0]?.id ?? "manual-intro";
      setActiveSection(fallback);
      window.history.replaceState(null, "", `#${fallback}`);
    }
  }, [auth.role, activeSection]);

  const selectSection = (id: ManualSectionId) => {
    setActiveSection(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <div
      className={`${pageStyles.page} ${poppins.className} ${collapsed ? pageStyles.collapsed : ""} ${
        darkMode ? pageStyles.dark : ""
      } ${sidebarRight ? pageStyles.sidebarRight : ""}`}
    >
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <main className={`${pageStyles.main} ${styles.docsMain}`}>
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
          <div className={styles.docsShell}>
            <div className={styles.manualLayout}>
              <nav className={styles.toc} aria-label="Índice del manual">
                <p className={styles.tocTitle}>Índice</p>
                <ul>
                  {manualTocEntriesForRole(auth.role).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`${styles.tocButton} ${item.id === activeSection ? styles.tocButtonActive : ""}`}
                        onClick={() => selectSection(item.id)}
                        aria-current={item.id === activeSection ? "page" : undefined}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <div ref={viewerRef} className={styles.manualViewer} tabIndex={-1}>
                <ManualChapter id={activeSection} role={auth.role} />
              </div>
            </div>
          </div>
        </PageContent>
      </main>
    </div>
  );
}
