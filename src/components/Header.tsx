"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FiCalendar,
  FiMessageSquare,
  FiSliders,
  FiMoon,
  FiSun,
  FiToggleLeft,
  FiToggleRight,
  FiColumns,
  FiBell,
  FiUser,
  FiLogOut,
  FiAlertTriangle,
  FiGrid,
} from "react-icons/fi";
import styles from "../app/page.module.css";
import { useAuthSession } from "./AuthGate";
import { resolveMessagesApi } from "@/utils/api";
import { useSlaAlerts } from "@/hooks/useSlaAlerts";
import { useNotionToggle } from "@/contexts/NotionToggleContext";
import { useMessagesToggle } from "@/contexts/MessagesToggleContext";
import { useCalendarToggle } from "@/contexts/CalendarToggleContext";
import { setPendingWorkspacePanel } from "@/lib/workspaceNav";
import { userCanAccessPath } from "@/lib/departments";

type HeaderProps = {
  showNotifications: boolean;
  setShowNotifications: (v: boolean) => void;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  sidebarRight: boolean;
  setSidebarRight: (v: boolean) => void;
};

const ROLE_LABELS: Record<string, string> = {
  user: "Usuario",
  admin: "Administrador",
  dev: "Desarrollador",
};

export function Header({
  showNotifications,
  setShowNotifications,
  showSettings,
  setShowSettings,
  darkMode,
  setDarkMode,
  sidebarRight,
  setSidebarRight,
}: HeaderProps) {
  const router = useRouter();
  const { user, logout, role } = useAuthSession();
  const { isNotionRoute, notionTransition, toggleNotion } = useNotionToggle();
  const { showMessages, setShowMessages } = useMessagesToggle();
  const { showCalendar, setShowCalendar } = useCalendarToggle();
  const canSeeAlertas = userCanAccessPath(role, user?.areas, "/alertas");
  const { pendingCount: slaPendingCount } = useSlaAlerts(canSeeAlertas ? 8 : 0);
  const settingsRef  = useRef<HTMLDivElement>(null);
  const notifyRef    = useRef<HTMLDivElement>(null);
  const userMenuRef  = useRef<HTMLDivElement>(null);
  const [showUserMenu, setShowUserMenu]     = useState(false);
  const [unreadCount, setUnreadCount]       = useState(0);

  const myId = user?.id ?? "";
  const notionActive = isNotionRoute && notionTransition !== "close";
  const calendarActive = showCalendar && !showMessages && !notionActive;
  const messagesActive = showMessages && !showCalendar && !notionActive;

  const fetchUnread = useCallback(async () => {
    if (!myId) return;
    try {
      const res = await fetch(`${resolveMessagesApi()}?userId=${encodeURIComponent(myId)}&unread=1`);
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unread ?? 0);
      }
    } catch { /* noop */ }
  }, [myId]);

  useEffect(() => {
    const tid = window.setTimeout(() => void fetchUnread(), 0);
    const interval = setInterval(() => void fetchUnread(), 15000);
    return () => {
      window.clearTimeout(tid);
      clearInterval(interval);
    };
  }, [fetchUnread]);

  useEffect(() => {
    if (!showMessages) void fetchUnread();
  }, [showMessages, fetchUnread]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showSettings && settingsRef.current && !settingsRef.current.contains(target)) {
        setShowSettings(false);
      }
      if (showNotifications && notifyRef.current && !notifyRef.current.contains(target)) {
        setShowNotifications(false);
      }
      if (showUserMenu && userMenuRef.current && !userMenuRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings, showNotifications, showUserMenu, setShowSettings, setShowNotifications]);

  const handleCalendarClick = () => {
    if (showCalendar) {
      setShowCalendar(false);
      return;
    }
    setShowMessages(false);
    if (notionActive) {
      setPendingWorkspacePanel("calendar");
      toggleNotion();
      return;
    }
    setShowCalendar(true);
  };

  const handleMessagesClick = () => {
    if (showMessages) {
      setShowMessages(false);
      void fetchUnread();
      return;
    }
    setShowCalendar(false);
    if (notionActive) {
      setPendingWorkspacePanel("messages");
      toggleNotion();
      return;
    }
    setShowMessages(true);
    void fetchUnread();
  };

  const handleNotionClick = () => {
    toggleNotion();
  };

  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.headerNav}>
          <button
            className={`${styles.headLink} ${calendarActive ? styles.headLinkActive : ""}`}
            aria-label="Calendario"
            onClick={handleCalendarClick}
          >
            <FiCalendar />
          </button>

          <button
            className={`${styles.headLink} ${messagesActive ? styles.headLinkActive : ""}`}
            aria-label="Mensajes"
            onClick={handleMessagesClick}
            style={{ position: "relative" }}
          >
            <FiMessageSquare />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -3, right: -3,
                minWidth: 16, height: 16, borderRadius: 8,
                background: "#ef4444", color: "#fff",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "0 3px", lineHeight: 1,
              }}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`${styles.headLink} ${notionActive ? styles.headLinkActive : ""}`}
            aria-label="Notion"
            title="Notion"
            onClick={handleNotionClick}
          >
            <FiGrid />
          </button>
        </div>

        <div className={styles.headerActions}>
          {canSeeAlertas ? (
          <button
            type="button"
            className={styles.alertsBtn}
            onClick={() => router.push("/alertas")}
            aria-label="Ver alertas"
          >
            <FiAlertTriangle />
            <span>Alertas</span>
            {slaPendingCount > 0 && (
              <span className={styles.alertsBtnBadge}>{slaPendingCount > 99 ? "99+" : slaPendingCount}</span>
            )}
          </button>
          ) : null}

          <div className={styles.settingsWrap} ref={settingsRef}>
            <button
              className={styles.actionIcon}
              aria-label="Personalización"
              onClick={() => setShowSettings(!showSettings)}
            >
              <FiSliders />
            </button>
            {showSettings && (
              <div className={`${styles.settingsDropdown} ${styles.flyoutPs5Enter} ${styles.flyoutPs5OriginTopRight}`}>
                <div className={styles.settingsHeader}>Personalización</div>
                <div className={`${styles.toggleRow} ${darkMode ? styles.toggleOn : ""}`} onClick={() => setDarkMode(!darkMode)}>
                  <div className={styles.toggleLabel}>
                    {darkMode ? <FiMoon /> : <FiSun />}
                    <span>Modo oscuro</span>
                  </div>
                  <div className={styles.toggleIcon}>{darkMode ? <FiToggleRight /> : <FiToggleLeft />}</div>
                </div>
                <div className={`${styles.toggleRow} ${sidebarRight ? styles.toggleOn : ""}`} onClick={() => setSidebarRight(!sidebarRight)}>
                  <div className={styles.toggleLabel}>
                    <FiColumns />
                    <span>Sidebar a la derecha</span>
                  </div>
                  <div className={styles.toggleIcon}>{sidebarRight ? <FiToggleRight /> : <FiToggleLeft />}</div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.notifyWrap} ref={notifyRef}>
            <button
              className={styles.actionIcon}
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notificaciones"
            >
              <FiBell />
            </button>
            {showNotifications && (
              <div className={`${styles.notifyDropdown} ${styles.flyoutPs5Enter} ${styles.flyoutPs5OriginTopRight}`}>
                <div className={styles.notifyHeader}>
                  <span>Notificaciones</span>
                </div>
                <div className={styles.notifyList}>
                  <div className={styles.notifyEmpty}>No tienes notificaciones nuevas.</div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.userMenuWrap} ref={userMenuRef}>
            <button
              className={styles.actionIcon}
              aria-label="Usuario"
              onClick={() => setShowUserMenu((v) => !v)}
            >
              <FiUser />
            </button>
            {showUserMenu && (
              <div className={`${styles.userDropdown} ${styles.flyoutPs5Enter} ${styles.flyoutPs5OriginTopRight}`}>
                <div className={styles.userDropdownInfo}>
                  <div className={styles.userAvatar}><FiUser /></div>
                  <div>
                    <div className={styles.userDisplayName}>{user?.displayName ?? user?.username}</div>
                    <div className={styles.userUsername}>@{user?.username}</div>
                  </div>
                </div>
                <div className={styles.userRoleBadge} data-role={user?.role}>
                  {ROLE_LABELS[user?.role ?? "user"] ?? user?.role}
                </div>
                <button
                  className={styles.userLogoutBtn}
                  onClick={() => { setShowUserMenu(false); logout(); }}
                >
                  <FiLogOut />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
