"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  FiMenu,
  FiLogOut,
  FiHome,
  FiUsers,
  FiBriefcase,
  FiChevronRight,
  FiDollarSign,
  FiUserCheck,
  FiTruck,
  FiActivity,
  FiLock,
  FiBarChart2,
  FiBookOpen,
  FiCalendar,
  FiInbox,
  FiMonitor,
  FiAward,
  FiLayout,
  FiHardDrive,
} from "react-icons/fi";
import styles from "../app/page.module.css";
import { useAuthSession, type UserRole } from "./AuthGate";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useUserAvatar } from "@/utils/avatars";
import { AvatarPicker } from "./AvatarPicker";
import { userCanAccessNavSection } from "@/lib/departments";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const asset = (path: string) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

type NavDef = { label: string; icon: ReactNode; path: string; minRole?: UserRole[]; disabled?: boolean };
type NavSectionDef = { id: string; label: string; icon: ReactNode; items: NavDef[] };

const navSections: NavSectionDef[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: <FiHome />,
    items: [
      { label: "Portal", icon: <FiLayout />, path: "/" },
    ],
  },
  {
    id: "administrativo",
    label: "Administrativo",
    icon: <FiBriefcase />,
    items: [
      { label: "Análisis", icon: <FiBarChart2 />, path: "/analisis" },
      { label: "Usuarios", icon: <FiUsers />, path: "/usuarios", minRole: ["admin", "dev"] },
    ],
  },
  {
    id: "ti",
    label: "Tecnología e Informática",
    icon: <FiMonitor />,
    items: [
      { label: "Tickets", icon: <FiInbox />, path: "/tickets", minRole: ["admin", "dev"] },
      { label: "Equipos", icon: <FiHardDrive />, path: "/equipos", minRole: ["admin", "dev"] },
      { label: "Documentación", icon: <FiBookOpen />, path: "/docs" },
    ],
  },
  {
    id: "calidad",
    label: "Calidad",
    icon: <FiAward />,
    items: [
      { label: "Plan Anual", icon: <FiCalendar />, path: "/programa-anual" },
    ],
  },
  {
    id: "finanzas",
    label: "Contabilidad y Finanzas",
    icon: <FiDollarSign />,
    items: [
      { label: "Próximamente", icon: <FiDollarSign />, path: "#", disabled: true },
    ],
  },
  {
    id: "rrhh",
    label: "Recursos Humanos",
    icon: <FiUserCheck />,
    items: [
      { label: "Dashboard RRHH", icon: <FiUserCheck />, path: "/rrhh" },
    ],
  },
  {
    id: "logistica",
    label: "Logística",
    icon: <FiTruck />,
    items: [
      { label: "Próximamente", icon: <FiTruck />, path: "#", disabled: true },
    ],
  },
  {
    id: "operaciones",
    label: "Operaciones",
    icon: <FiActivity />,
    items: [
      { label: "Próximamente", icon: <FiActivity />, path: "#", disabled: true },
    ],
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  user: "Usuario",
  admin: "Administrador",
  dev: "Desarrollador",
};

type SidebarProps = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
};

export function Sidebar(props: SidebarProps) {
  const { collapsed, setCollapsed } = props;
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const auth = useAuthSession();
  const role = auth.role;
  const userAreas = auth.user?.areas ?? [];
  const avatar = useUserAvatar(auth.user?.username ?? "", auth.user?.displayName ?? "");
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const normalizedPath = (() => {
    if (BASE && pathname.startsWith(BASE)) {
      const sliced = pathname.slice(BASE.length);
      return sliced || "/";
    }
    return pathname || "/";
  })();

  const isActivePath = (target: string) => {
    const targetWithSlash = target.endsWith("/") ? target : `${target}/`;
    const currentWithSlash = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;
    if (target === "/") {
      return currentWithSlash === targetWithSlash;
    }
    return normalizedPath === target || currentWithSlash.startsWith(targetWithSlash);
  };

  const visibleSections = useMemo(
    () =>
      navSections
        .map((section) => {
          const areaLocked = !userCanAccessNavSection(role, userAreas, section.id);
          if (areaLocked) {
            return {
              ...section,
              areaLocked: true as const,
              items: section.items.map((item) => ({ ...item, disabled: true })),
            };
          }
          return {
            ...section,
            areaLocked: false as const,
            items: section.items.filter((item) => {
              if (!item.minRole) return true;
              return role ? item.minRole.includes(role) : false;
            }),
          };
        })
        .filter((section) => section.areaLocked || section.items.length > 0),
    [role, userAreas]
  );

  // Sección que contiene la ruta actual (para resaltar y abrir por defecto)
  const routeSectionId = useMemo(() => {
    const match = visibleSections.find((section) => section.items.some((item) => isActivePath(item.path)));
    return match?.id ?? visibleSections[0]?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSections, normalizedPath]);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(routeSectionId);
  const [animateSection, setAnimateSection] = useState(false);

  const persistSidebarSection = (sectionId: string) => {
    try {
      window.sessionStorage.setItem("dashboard-sidebar-section", sectionId);
    } catch {}
  };

  // Sincroniza el panel con la sección de la ruta actual al navegar (sin animación)
  useEffect(() => {
    if (routeSectionId) {
      setActiveSectionId(routeSectionId);
      persistSidebarSection(routeSectionId);
    }
  }, [routeSectionId]);

  const selectSidebarSection = (sectionId: string) => {
    if (activeSectionId !== sectionId) {
      setAnimateSection(true);
      window.setTimeout(() => setAnimateSection(false), 320);
      persistSidebarSection(sectionId);
    }
    setActiveSectionId(sectionId);
  };

  const activeSection =
    visibleSections.find((section) => section.id === activeSectionId) ??
    visibleSections.find((section) => section.id === routeSectionId) ??
    visibleSections[0] ??
    null;
  const showInicioWelcome = activeSectionId === "inicio";

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ""}`}
      data-dashboard-sidebar
    >
      {/* Riel de iconos (una entrada por grupo) */}
      <div className={styles.sidebarRail}>
        <div className={styles.railList}>
          {visibleSections.map((section) => {
            const sectionActive = section.items.some((item) => isActivePath(item.path));
            const isSelected = activeSectionId === section.id;
            const locked = Boolean(section.areaLocked);
            return (
              <button
                key={section.id}
                type="button"
                title={locked ? `${section.label} (sin acceso)` : section.label}
                aria-label={locked ? `${section.label} bloqueado` : section.label}
                className={`${styles.railItem} ${isSelected ? styles.railItemSelected : ""} ${sectionActive ? styles.railItemActive : ""} ${locked ? styles.railItemLocked : ""}`}
                onClick={() => {
                  selectSidebarSection(section.id);
                  if (collapsed) setCollapsed(false);
                }}
              >
                {section.icon}
                {locked ? <FiLock className={styles.railLockBadge} aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.railItem}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          onClick={() => {
            auth.logout();
            router.replace("/");
          }}
        >
          <FiLogOut />
        </button>
      </div>

      {/* Panel con las opciones del grupo seleccionado */}
      <div className={styles.sidebarPanel}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático desde /public */}
            <img src={asset("/logo_gray.png")} alt="Bocasión" className={styles.logo} />
          </div>
          <button className={styles.menuToggle} onClick={() => setCollapsed(!collapsed)} aria-label="Alternar menú">
            <FiMenu />
          </button>
        </div>

        {/* Solo sección Inicio: nombre de empresa + tarjeta de usuario */}
        {showInicioWelcome ? (
          <>
            <div className={styles.panelCompany}>Bocasión Intranet</div>
            {auth.user && (
              <div className={styles.panelUserCard}>
                <button
                  type="button"
                  className={styles.panelUserAvatar}
                  onClick={() => setShowAvatarPicker(true)}
                  title="Cambiar personaje"
                  aria-label="Cambiar personaje"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- avatar remoto (DiceBear) */}
                  <img src={avatar.url} alt={auth.user.displayName} />
                </button>
                <div className={styles.panelUserMeta}>
                  <span className={styles.panelUserHi}>¡Hola!</span>
                  <span className={styles.panelUserName}>{auth.user.displayName}</span>
                  <span className={styles.panelUserRole}>{ROLE_LABELS[auth.user.role]}</span>
                </div>
              </div>
            )}
          </>
        ) : null}

        <nav className={styles.sidebarNav}>
          {activeSection ? (
            <div key={activeSection.id} className={`${styles.navSection} ${animateSection ? styles.navSectionTransition : ""}`}>
              <div className={styles.panelSectionTitle}>
                <span>{activeSection.label}</span>
                {activeSection.areaLocked ? <FiLock aria-hidden /> : null}
              </div>
              {activeSection.areaLocked ? (
                <div className={styles.areaLockedNotice}>
                  <FiLock />
                  <p>No tienes acceso a esta área.</p>
                  <span>Pide a un administrador que te asigne el área correspondiente.</span>
                </div>
              ) : (
              <div className={styles.navSectionList}>
                {activeSection.items.map((item) => {
                  const isActive = isActivePath(item.path);
                  if (item.disabled) {
                    return (
                      <div
                        key={item.label}
                        className={`${styles.navItem} ${styles.navSubItem} ${styles.navItemDisabled}`}
                        aria-disabled="true"
                        title="Próximamente"
                      >
                        {item.icon}
                        <span className={styles.navItemText}>
                          <span className={styles.navItemLabel}>{item.label}</span>
                        </span>
                        <FiLock className={styles.navItemChevron} />
                      </div>
                    );
                  }
                  return (
                    <button
                      key={item.label}
                      className={`${styles.navItem} ${styles.navSubItem} ${isActive ? styles.navItemActive : ""}`}
                      onClick={() => router.push(item.path)}
                    >
                      {item.icon}
                      <span className={styles.navItemText}>
                        <span className={styles.navItemLabel}>{item.label}</span>
                      </span>
                      <FiChevronRight className={styles.navItemChevron} />
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          ) : null}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            className={styles.logoutBtn}
            onClick={() => {
              auth.logout();
              router.replace("/");
            }}
          >
            <FiLogOut />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>

      {showAvatarPicker && auth.user && (
        <AvatarPicker
          currentId={avatar.avatarId}
          onSelect={(id) => avatar.setAvatar(id)}
          onClose={() => setShowAvatarPicker(false)}
        />
      )}
    </aside>
  );
}
