"use client";

import {
  FiCalendar,
  FiMessageSquare,
  FiSearch,
  FiSliders,
  FiBell,
  FiUser,
  FiHome,
  FiBarChart2,
  FiLayers,
  FiFileText,
  FiMove,
  FiEye,
} from "react-icons/fi";
import mp from "./manualPreviews.module.css";

function TopBarStrip() {
  return (
    <div className={mp.topBarMini}>
      <div className={mp.topBarLeft}>
        <span className={mp.iconBtn} title="Calendario">
          <FiCalendar size={15} />
        </span>
        <span className={mp.iconBtn} title="Mensajes">
          <FiMessageSquare size={15} />
        </span>
        <div className={mp.searchMini}>
          <FiSearch size={12} />
          <span>Buscar tickets…</span>
        </div>
      </div>
      <div className={mp.topBarRight}>
        <span className={mp.actionMini}>
          <FiSliders size={14} />
        </span>
        <span className={mp.actionMini}>
          <FiBell size={14} />
        </span>
        <span className={mp.actionMini}>
          <FiUser size={14} />
        </span>
      </div>
    </div>
  );
}

/** Layout lateral + cabecera + contenido (misma jerarquía que la app). */
export function PreviewLayoutGeneral() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.layoutRow}>
        <div className={mp.sidebarCol}>
          <div className={mp.sidebarBrand}>
            <span className={mp.brandMark} />
            <span className={mp.brandText} />
          </div>
          <div className={mp.navStack}>
            <div className={`${mp.navMini} ${mp.navMiniActive}`}>
              <FiHome size={13} />
              <span>Home</span>
            </div>
            <div className={mp.navMini}>
              <FiBarChart2 size={13} />
              <span>Análisis</span>
            </div>
            <div className={mp.navMini}>
              <FiLayers size={13} />
              <span>Notion</span>
            </div>
            <div className={mp.navMini}>
              <FiBell size={13} />
              <span>Alertas</span>
            </div>
            <div className={mp.navMini}>
              <FiFileText size={13} />
              <span>Docs</span>
            </div>
          </div>
          <div className={mp.sidebarFoot}>
            <span className={mp.avatarMini}>U</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 10 }}>Usuario</div>
              <div className={mp.previewMuted} style={{ fontSize: 9 }}>
                Rol
              </div>
            </div>
          </div>
        </div>
        <div className={mp.mainCol}>
          <TopBarStrip />
          <div className={mp.contentMini}>
            <div className={mp.titleLine} />
            <div className={mp.cardRow}>
              <div className={mp.statPill}>
                <span className={mp.previewMuted}>Total</span>
                <strong>128</strong>
              </div>
              <div className={mp.statPill}>
                <span className={mp.previewMuted}>Pend.</span>
                <strong>42</strong>
              </div>
            </div>
            <div className={mp.chartBox}>
              <div className={mp.chartFakeLine2} />
              <div className={mp.chartFakeLine} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Réplica del orden real de la cabecera (Header.tsx). */
export function PreviewBarraSuperior() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.barOnly}>
        <TopBarStrip />
      </div>
    </div>
  );
}

export function PreviewHome() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.layoutRow} style={{ minHeight: 155 }}>
        <div className={mp.sidebarCol} style={{ width: 72 }}>
          <div className={mp.sidebarBrand}>
            <span className={mp.brandMark} />
          </div>
          <div className={`${mp.navMini} ${mp.navMiniActive}`} style={{ margin: "8px 6px" }}>
            <FiHome size={13} />
          </div>
        </div>
        <div className={mp.mainCol}>
          <TopBarStrip />
          <div className={mp.contentMini}>
            <div className={mp.homeGrid}>
              <div className={mp.homeLeft}>
                <div className={mp.cardRow}>
                  <div className={mp.statPill}>
                    <span className={mp.previewMuted}>Soluc.</span>
                    <strong>62</strong>
                  </div>
                  <div className={mp.statPill}>
                    <span className={mp.previewMuted}>Pend.</span>
                    <strong>38</strong>
                  </div>
                </div>
                <div className={mp.homePercent}>
                  <span className={mp.previewMuted} style={{ fontWeight: 700 }}>
                    Porcentajes
                  </span>
                  <div className={mp.percentFake} />
                  <div className={mp.percentFake} style={{ width: "80%" }} />
                </div>
              </div>
              <div className={mp.chartBox} style={{ minHeight: 120 }}>
                <div className={mp.rangeFake} style={{ padding: 8 }}>
                  <span className={`${mp.rangeChip} ${mp.rangeChipOn}`}>7D</span>
                  <span className={mp.rangeChip}>30D</span>
                  <span className={mp.rangeChip}>Todo</span>
                </div>
                <div className={mp.chartFakeLine2} />
                <div className={mp.chartFakeLine} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PreviewAnalisis() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div style={{ padding: 12, background: "var(--bg)", borderRadius: 12, border: `1px solid var(--border)` }}>
        <div className={mp.previewMuted} style={{ fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
          Arrastra por el icono ⋮⋮ para reordenar
        </div>
        <div className={mp.widgetGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={mp.widgetCard}>
              <FiMove className={mp.dragHint} />
              <div style={{ fontWeight: 700, fontSize: 10 }}>Widget {i}</div>
              <div className={mp.widgetBars}>
                <div className={mp.widgetBar} style={{ height: `${24 + i * 8}px` }} />
                <div className={mp.widgetBar} style={{ height: `${40 - i * 6}px`, opacity: 0.7 }} />
                <div className={mp.widgetBar} style={{ height: `${32 + i * 4}px`, opacity: 0.55 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PreviewTickets() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div style={{ padding: 12, background: "var(--card)", borderRadius: 12, border: `1px solid var(--border)` }}>
        <div className={mp.ticketsToolbar}>
          <span className={mp.filterPill}>Estado</span>
          <span className={mp.filterPill}>Fechas</span>
          <span className={mp.filterPill}>Exportar ▾</span>
        </div>
        <table className={mp.tableMini}>
          <thead>
            <tr>
              <th>Nº</th>
              <th>Incidencia</th>
              <th>Estado</th>
              <th>Asignado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1042</td>
              <td>Fallo de red…</td>
              <td>
                <span className={mp.badgeEstado}>pendiente</span>
              </td>
              <td>Ana</td>
            </tr>
            <tr>
              <td>1041</td>
              <td>Actualización…</td>
              <td>
                <span className={mp.badgeEstado}>solucionado</span>
              </td>
              <td>Luis</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PreviewAlertas() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.alertList}>
        <div className={mp.alertRow}>
          <span className={`${mp.alertStripe} ${mp.stripeCrit}`} />
          <div>
            <strong style={{ fontSize: 11 }}>Crítico</strong>
            <div className={mp.previewMuted} style={{ fontSize: 10 }}>
              Ticket abierto &gt; 30 días
            </div>
          </div>
        </div>
        <div className={mp.alertRow}>
          <span className={`${mp.alertStripe} ${mp.stripeHigh}`} />
          <div>
            <strong style={{ fontSize: 11 }}>Alta</strong>
            <div className={mp.previewMuted} style={{ fontSize: 10 }}>
              Priorizar esta semana
            </div>
          </div>
        </div>
        <div className={mp.alertRow}>
          <span className={`${mp.alertStripe} ${mp.stripeMed}`} />
          <div>
            <strong style={{ fontSize: 11 }}>Media</strong>
            <div className={mp.previewMuted} style={{ fontSize: 10 }}>
              Seguimiento habitual
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PreviewNotionTabs() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid var(--border)` }}>
        <div className={mp.notionBar}>
          <div className={`${mp.tabFake} ${mp.tabFakeActive}`}>
            <FiLayers size={12} />
            Mis Tareas
          </div>
          <div className={mp.tabFake}>
            <FiLayers size={12} />
            Otra tabla
          </div>
        </div>
        <div className={mp.notionGrid}>
          <div className={mp.gridHead}>
            <span />
            <span>Texto</span>
            <span>Estado</span>
            <span>Fecha</span>
          </div>
          <div className={mp.gridRow}>
            <span className={mp.cellMuted}>○</span>
            <span>Recepción…</span>
            <span className={mp.badgeEstado}>Listo</span>
            <span className={mp.cellMuted}>10 may.</span>
          </div>
          <div className={mp.gridRow}>
            <span className={mp.cellMuted}>○</span>
            <span>Clasificación…</span>
            <span className={mp.badgeEstado}>Sin empezar</span>
            <span className={mp.cellMuted}>17 may.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PreviewCalendario() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.calWrap} style={{ borderRadius: 12, border: `1px solid var(--border)` }}>
        <div className={mp.calHeader}>
          <span>‹</span>
          <span>Mayo 2026</span>
          <span>›</span>
        </div>
        <div className={mp.calGrid}>
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
            <div key={d} className={mp.calDow}>
              {d}
            </div>
          ))}
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <div key={d} className={`${mp.calCell} ${d === 16 ? mp.calCellDot : ""}`}>
              {d}
            </div>
          ))}
        </div>
        <p className={mp.previewMuted} style={{ fontSize: 10, margin: "10px 0 0", textAlign: "center" }}>
          Misma vista que al pulsar el icono de calendario en la cabecera
        </p>
      </div>
    </div>
  );
}

export function PreviewAtajosTeclado() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div className={mp.helpPanel}>
        <div className={mp.helpTitle}>Atajos</div>
        <div className={mp.helpRow}>
          <span>Cerrar calendario</span>
          <span className={mp.kbd}>Esc</span>
        </div>
        <div className={mp.helpRow}>
          <span>Ayuda / atajos</span>
          <span className={mp.kbd}>?</span>
        </div>
        <div className={mp.helpRow}>
          <span>Navegar controles</span>
          <span className={mp.kbd}>Tab</span>
        </div>
      </div>
    </div>
  );
}

export function PreviewUsuarios() {
  return (
    <div className={mp.previewRoot} aria-hidden>
      <div style={{ padding: 14, background: "var(--card)", borderRadius: 12, border: `1px solid var(--border)` }}>
        <div className={mp.usersHead}>
          <span className={mp.usersTitle}>Gestión de Usuarios</span>
          <span className={mp.usersBtn}>+ Nuevo</span>
        </div>
        <table className={mp.tableMini}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>María</td>
              <td className={mp.cellMuted}>maria</td>
              <td>
                <span className={mp.badgeEstado}>Admin</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={mp.iconGhost}>
                  <FiEye size={13} />
                </span>
              </td>
            </tr>
            <tr>
              <td>Juan</td>
              <td className={mp.cellMuted}>juan</td>
              <td>
                <span className={mp.badgeEstado}>Usuario</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <span className={mp.iconGhost}>
                  <FiEye size={13} />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
