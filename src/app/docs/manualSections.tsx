import Link from "next/link";
import { FiCalendar, FiCpu, FiLifeBuoy } from "react-icons/fi";
import type { UserRole } from "@/components/AuthGate";
import { ManualFigure } from "./ManualFigure";
import {
  PreviewAlertas,
  PreviewAnalisis,
  PreviewAtajosTeclado,
  PreviewBarraSuperior,
  PreviewCalendario,
  PreviewHome,
  PreviewLayoutGeneral,
  PreviewNotionTabs,
  PreviewTickets,
  PreviewUsuarios,
} from "./ManualUiFigures";
import styles from "./page.module.css";

export const MANUAL_TOC = [
  { id: "manual-intro", label: "Qué es este panel" },
  { id: "manual-interfaz", label: "Interfaz común" },
  { id: "manual-home", label: "Home" },
  { id: "manual-analisis", label: "Análisis" },
  { id: "manual-tickets", label: "Tickets", minRoles: ["admin", "dev"] as const },
  { id: "manual-alertas", label: "Alertas" },
  { id: "manual-notion", label: "Notion (tablas)" },
  { id: "manual-calendario", label: "Calendario" },
  { id: "manual-atajos", label: "Atajos de teclado" },
  { id: "manual-soporte", label: "Errores y soporte" },
  { id: "manual-calidad", label: "Tests y calidad", minRoles: ["admin", "dev"] as const },
  { id: "manual-usuarios", label: "Usuarios", minRoles: ["admin", "dev"] as const },
  { id: "manual-docs", label: "Esta documentación" },
  { id: "manual-acceso", label: "Sesión y permisos" },
] as const;

export type ManualSectionId = (typeof MANUAL_TOC)[number]["id"];

type ManualTocEntry = (typeof MANUAL_TOC)[number];

/** Alineado con el menú lateral: capítulos con minRoles solo si el rol está en la lista. */
export function isManualSectionVisibleForRole(sectionId: ManualSectionId, role: UserRole | null): boolean {
  const entry = MANUAL_TOC.find((t) => t.id === sectionId);
  if (!entry) return false;
  const min = "minRoles" in entry ? entry.minRoles : undefined;
  if (!min?.length) return true;
  return role != null && (min as readonly UserRole[]).includes(role);
}

export function manualTocEntriesForRole(role: UserRole | null): ManualTocEntry[] {
  return MANUAL_TOC.filter((t) => isManualSectionVisibleForRole(t.id, role)) as ManualTocEntry[];
}

export function isManualSectionId(value: string): value is ManualSectionId {
  return MANUAL_TOC.some((t) => t.id === value);
}

export function ManualChapter({ id, role }: { id: ManualSectionId; role: UserRole | null }) {
  const isStaff = role === "admin" || role === "dev";
  const isDev = role === "dev";
  const isAdmin = role === "admin";
  switch (id) {
    case "manual-intro":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Qué es este panel</h2>
            <p className={styles.chapterIntro}>
              Es un escritorio web para gestionar tickets de soporte, ver métricas, trabajar tablas tipo Notion con columnas
              personalizables, revisar alertas por antigüedad y coordinar fechas en un calendario compartido. La barra lateral te lleva de
              un módulo a otro; la parte superior repite atajos útiles en todas las pantallas. Este manual muestra en el índice solo las
              secciones que corresponden a tu rol.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="layout-general.png"
                alt="Captura del layout del panel con menú lateral y zona principal."
                fallback={<PreviewLayoutGeneral />}
              />
            </div>
            <figcaption className={styles.caption}>
              Preferimos una captura real generada con la herramienta del repositorio; coincide con tu tema y datos locales. Si no hay PNG,
              se muestra la vista simplificada integrada.
            </figcaption>
          </figure>
        </article>
      );

    case "manual-interfaz":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Interfaz común en todas las páginas</h2>
            <p className={styles.chapterIntro}>
              Independientemente del módulo, dispones de los mismos controles globales arriba y del menú lateral.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="barra-superior.png"
                alt="Captura de la barra superior del panel."
                fallback={<PreviewBarraSuperior />}
              />
            </div>
            <figcaption className={styles.caption}>
              Captura del orden real: calendario, mensajes, buscador, personalización, campana y usuario (según tu instalación).
            </figcaption>
          </figure>
          <div className={styles.subBlock}>
            <h3>Barra superior</h3>
            <ul className={styles.list}>
              <li>
                <strong>Calendario:</strong> abre el mismo calendario en cualquier pantalla; los eventos se comparten entre Home
                {isStaff ? ", Tickets" : ""}, Notion y el resto de módulos.
              </li>
              <li>
                <strong>Búsqueda:</strong>{" "}
                {isStaff
                  ? "en Tickets abre el buscador lateral para localizar una ficha rápidamente; en otras páginas puede actuar como filtro en línea si la vista lo permite."
                  : "según la página, filtra u ordena en la propia vista (no tienes acceso al buscador amplio de Tickets)."}
              </li>
              <li>
                <strong>Mensajes:</strong> panel de mensajería interna con aviso de no leídos cuando hay backend configurado.
              </li>
              <li>
                <strong>Campana:</strong> centro de notificaciones (placeholder hasta que conectes alertas reales).
              </li>
              <li>
                <strong>Ajustes:</strong> modo claro u oscuro y opción de mover la barra lateral al lado derecho.
              </li>
              <li>
                <strong>Tu usuario:</strong> nombre, rol y <strong>Cerrar sesión</strong>, que borra la sesión del navegador.
              </li>
            </ul>
          </div>
          <div className={styles.subBlock}>
            <h3>Barra lateral</h3>
            <ul className={styles.list}>
              <li>
                <strong>Colapsar:</strong> el botón del menú reduce el ancho para ganar espacio de trabajo.
              </li>
              <li>
                <strong>Navegación:</strong>{" "}
                {isStaff ? (
                  <>
                    Home, Análisis, <strong>Tickets</strong>, Notion, Alertas, Documentación y <strong>Usuarios</strong> aparecen en tu menú con
                    el mismo orden que en la aplicación.
                  </>
                ) : (
                  <>
                    como usuario estándar verás Home, Análisis, Notion, Alertas y Documentación; Tickets y Usuarios no se muestran porque tu rol
                    no incluye esas pantallas.
                  </>
                )}
              </li>
              {isStaff ? (
                <li>
                  <strong>Tickets:</strong> Admin y Dev usan la misma mesa completa (filtros, edición, exportaciones).
                  <strong> Usuarios:</strong> ambos entran a la pantalla; solo <strong>Dev</strong> puede dar de alta, editar o eliminar cuentas.
                  <strong> Admin</strong> consulta el listado y abre la vista de solo lectura de las tablas Notion de cada persona (icono de ojo).
                </li>
              ) : null}
              <li>Debajo verás tu inicial, nombre y etiqueta de rol (Usuario, Admin o Dev).</li>
            </ul>
          </div>
        </article>
      );

    case "manual-home":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Home</h2>
            <p className={styles.chapterIntro}>
              Punto de entrada: alta rápida de tickets y vista de los últimos movimientos con un gráfico de tendencia.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="home-panel.png"
                alt="Captura de la página Home con estadísticas y gráfico."
                fallback={<PreviewHome />}
              />
            </div>
            <figcaption className={styles.caption}>
              Vista real de Home (métricas, porcentajes, rango temporal y gráfico); depende de los tickets cargados en tu entorno.
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>Rellena el formulario y envía para crear un ticket con fecha de alta y estado iniciales coherentes.</li>
            <li>La lista inferior muestra tickets recientes; puedes editar o solicitar borrado con confirmación.</li>
            <li>El gráfico permite cambiar el rango temporal (por ejemplo últimos 7 o 30 días) para ver volumen aproximado.</li>
            <li>Los avisos tipo snackbar confirman guardados, errores o situaciones que requieren atención.</li>
          </ul>
        </article>
      );

    case "manual-analisis":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Análisis</h2>
            <p className={styles.chapterIntro}>
              Cuadros estadísticos sobre los mismos tickets que el resto del panel: volumen, estados, contactos, responsables, motivos y
              evolución de resueltos.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="analisis-widgets.png"
                alt="Captura del módulo Análisis con varios gráficos."
                fallback={<PreviewAnalisis />}
              />
            </div>
            <figcaption className={styles.caption}>
              Pantalla Análisis con tus datos; puedes reordenar tarjetas arrastrando (como en la app).
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>Arrastra una tarjeta por el icono de mover para cambiar el orden; el orden se recuerda en este navegador.</li>
            <li>Pasa el ratón por cada gráfico para ver detalle en tooltip.</li>
            <li>Los datos se refrescan de forma periódica mientras mantienes la página abierta.</li>
          </ul>
        </article>
      );

    case "manual-tickets":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Tickets</h2>
            <p className={styles.chapterIntro}>
              Mesa de trabajo completa: filtrar, buscar, editar en ventana y sacar informes. <strong>Admin</strong> y <strong>Dev</strong> tienen
              aquí las mismas capacidades; la diferencia entre roles está sobre todo en la pantalla Usuarios.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="tickets-tabla.png"
                alt="Captura del módulo Tickets con tabla y filtros."
                fallback={<PreviewTickets />}
              />
            </div>
            <figcaption className={styles.caption}>
              Mesa Tickets con filtros y columnas reales; si tu rol no tiene acceso, la captura mostrará el aviso de permisos.
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>Combina filtros por estado, fechas, días abiertos, contacto o persona asignada para acotar la vista.</li>
            <li>La búsqueda global y el panel lateral de ayuda aceleran encontrar un número de ticket o texto en incidencia.</li>
            <li>Abre un ticket en el modal para modificar campos con validación y guardar cambios.</li>
            <li>
              Exporta la tabla (según los filtros activos) a <strong>PDF</strong>, <strong>CSV</strong>, <strong>Excel</strong> u{" "}
              <strong>ODS</strong> desde el menú de exportación de la propia pantalla.
            </li>
            <li>Si hay integración externa, usarás también los botones de sincronización que aparezcan en la barra de herramientas.</li>
          </ul>
        </article>
      );

    case "manual-alertas":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Alertas</h2>
            <p className={styles.chapterIntro}>
              Lista priorizada según cuánto lleva abierto cada ticket pendiente; no es un sistema aparte, reutiliza los datos de Tickets.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure file="alertas.png" alt="Captura del listado de alertas por antigüedad." fallback={<PreviewAlertas />} />
            </div>
            <figcaption className={styles.caption}>Lista de alertas calculada con tus tickets pendientes.</figcaption>
          </figure>
          <ul className={styles.list}>
            <li>Lee el nivel (crítico, alta, media, baja) y la recomendación asociada.</li>
            <li>
              Cada ítem enlaza con la lógica del ticket correspondiente para priorizar el seguimiento
              {isStaff ? " en Tickets o Home" : " desde Home u otros módulos donde gestiones el caso"}.
            </li>
            <li>La vista se actualiza al cambiar el reloj del navegador cada minuto para recalcular tiempos.</li>
          </ul>
        </article>
      );

    case "manual-notion":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Notion (tablas)</h2>
            <p className={styles.chapterIntro}>
              Tablero flexible con pestañas por tabla, columnas de muchos tipos, filtros, ordenación, selección múltiple, exportaciones y
              compartición entre usuarios.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="notion-tabs.png"
                alt="Captura del módulo Notion con pestañas y tabla."
                fallback={<PreviewNotionTabs />}
              />
            </div>
            <figcaption className={styles.caption}>
              Tu vista Notion real (pestañas, columnas y datos). La miniatura integrada solo aparece si falta el PNG.
            </figcaption>
          </figure>
          <div className={styles.subBlock}>
            <h3>Pestañas y vistas</h3>
            <ul className={styles.list}>
              <li>Cambia de tabla pinchando la pestaña correspondiente.</li>
              <li>Mantén pulsado sobre una pestaña para iniciar arrastre y reordenar (las fijadas van agrupadas al inicio).</li>
              <li>
                Menú de tres puntos en pestaña: duplicar tabla, fijar o desfijar, <strong>Compartir…</strong> (invitar a otro usuario), enviar a
                papelera (recuperación unos quince días) y más acciones según contexto.
              </li>
              <li>
                <strong>Compartidos conmigo:</strong> reabre tablas que otro usuario te envió sin perder el hilo de trabajo.
              </li>
              <li>Crea tablas nuevas o duplica una existente como base para plantillas propias.</li>
            </ul>
          </div>
          <div className={styles.subBlock}>
            <h3>Compartir tablas</h3>
            <ul className={styles.list}>
              <li>
                Cualquier usuario autenticado puede compartir sus tablas: botón <strong>Compartir</strong> en la barra superior o{" "}
                <strong>Compartir…</strong> en el menú de tres puntos de la pestaña (solo en tablas propias, no en las recibidas de otro).
              </li>
              <li>El destinatario recibe una invitación en mensajes; al aceptarla, la tabla aparece en <strong>Compartidos conmigo</strong>.</li>
              <li>
                <strong>Compartidos</strong> en la barra reabre tablas que te enviaron sin perder el hilo de trabajo.
              </li>
            </ul>
          </div>
          {isStaff ? (
            <div className={styles.subBlock}>
              <h3>Áreas (Admin y Dev)</h3>
              <ul className={styles.list}>
                <li>
                  Botón <strong>Áreas</strong> en la barra superior: gestiona las áreas asociadas a personas en columnas tipo Personas. Solo lo
                  ven roles Admin y Dev.
                </li>
              </ul>
            </div>
          ) : (
            <div className={styles.subBlock}>
              <p className={styles.note}>
                El botón <strong>Áreas</strong> (gestión de áreas de personas) lo llevan Admin y Dev; compartir tablas está disponible para todos.
              </p>
            </div>
          )}
          <div className={styles.subBlock}>
            <h3>Columnas y celdas</h3>
            <ul className={styles.list}>
              <li>
                Tipos habituales: texto, número, estado con colores, fechas, casillas, personas, correo, teléfono, URL, lugares, relaciones
                entre columnas, adjuntos y campos de solo lectura como última edición.
              </li>
              <li>
                Botón <strong>+</strong> en cabecera para añadir columnas; menú de propiedades para renombrar, ocultar, duplicar o fijar
                columna.
              </li>
              <li>Arrastra cabeceras para reordenar columnas en bloque.</li>
              <li>
                En columnas de personas y relación con áreas, al elegir una persona puede rellenarse automáticamente el área asociada si está
                configurada.
              </li>
            </ul>
          </div>
          <div className={styles.subBlock}>
            <h3>Filtros, orden y selección</h3>
            <ul className={styles.list}>
              <li>Barra de filtros por vista: combina chips para ver solo filas que cumplan varios criterios.</li>
              <li>Ordena por una columna a la vez desde el menú de cabecera.</li>
              <li>Selecciona varias filas para aplicar acciones en bloque desde la barra flotante de selección.</li>
            </ul>
          </div>
          <div className={styles.subBlock}>
            <h3>Exportar y papelera</h3>
            <ul className={styles.list}>
              <li>Exporta la vista actual a PDF o hojas de cálculo desde el menú de exportación de la tabla.</li>
              <li>
                Panel de papelera para restaurar tablas borradas recientemente o eliminarlas definitivamente tras confirmación.
              </li>
            </ul>
          </div>
        </article>
      );

    case "manual-calendario":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Calendario</h2>
            <p className={styles.chapterIntro}>Misma agenda en todas las páginas: lo que añades aquí se ve igual al cambiar de sección.</p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="calendario.png"
                alt="Captura del calendario a pantalla completa superpuesto."
                fallback={<PreviewCalendario />}
              />
            </div>
            <figcaption className={styles.caption}>
              Overlay FullCalendar tal como se abre desde la cabecera en cualquier pantalla autenticada.
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>Pulsa el icono de calendario en la cabecera para abrir el overlay.</li>
            <li>Navega por meses y crea eventos con título y fecha.</li>
            <li>Borra eventos que ya no apliquen directamente desde la vista mensual.</li>
            <li>Los datos pueden guardarse en el navegador y, si está configurado, sincronizarse con el servidor.</li>
          </ul>
        </article>
      );

    case "manual-atajos":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Atajos de teclado</h2>
            <p className={styles.chapterIntro}>
              Atajos globales cuando el foco no está en un campo de texto. También puedes abrir la ayuda rápida desde cualquier pantalla ya
              iniciada sesión.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="atajos-teclado.png"
                alt="Captura del diálogo de atajos de teclado."
                fallback={<PreviewAtajosTeclado />}
              />
            </div>
            <figcaption className={styles.caption}>
              Ventana “Atajos útiles” que aparece al pulsar <kbd>?</kbd> (por ejemplo <kbd>Shift</kbd> + tecla del slash).
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>
              <strong>Esc:</strong> cierra el calendario completo; si hay un formulario o confirmación abierta dentro del calendario, primero
              cierra ese paso.
            </li>
            <li>
              <strong>?</strong> (o <strong>Shift+/</strong>): abre el panel flotante de ayuda con los mismos atajos resumidos.
            </li>
            <li>
              <strong>Tab / Shift+Tab:</strong> recorre botones y enlaces en orden lógico para uso con teclado.
            </li>
          </ul>
        </article>
      );

    case "manual-soporte":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Errores y soporte</h2>
            <p className={styles.chapterIntro}>Qué hacer cuando algo falla u obliga a repetir el inicio de sesión.</p>
          </header>
          <div className={styles.subBlock}>
            <h3>
              <FiLifeBuoy size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
              Pantalla “Algo salió mal”
            </h3>
            <ul className={styles.list}>
              <li>Es el protector de errores de la aplicación: suele deberse a un bug puntual en una vista.</li>
              <li>
                Pulsa <strong>Recargar</strong>; si el problema persiste, anota la hora y la sección y repórtalo al equipo técnico.
              </li>
            </ul>
          </div>
          <div className={styles.subBlock}>
            <h3>Inicio de sesión bloqueado</h3>
            <ul className={styles.list}>
              <li>
                Tras muchos intentos fallidos seguidos, el servidor puede responder “Demasiados intentos”; espera unos minutos y vuelve a
                probar.
              </li>
              <li>Las contraseñas no viajan en la barra de direcciones; si ves un enlace con usuario y clave, no lo uses.</li>
            </ul>
          </div>
        </article>
      );

    case "manual-calidad":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Tests y calidad</h2>
            <p className={styles.chapterIntro}>
              El repositorio ejecuta comprobaciones automáticas en cada cambio (lint, tests unitarios y compilación). Sirven para detectar
              regresiones antes de publicar.
            </p>
          </header>
          <ul className={styles.list}>
            <li>
              <FiCpu size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
              Incluye pruebas de la firma de sesión del servidor y reglas de estilo de código.
            </li>
            <li>
              En servidor Linux de producción conviene definir <code>DASHBOARD_SESSION_SECRET</code> con un valor largo y aleatorio (Node y
              PHP deben coincidir si comparten sesión).
            </li>
            <li>Los registros estructurados de API pueden desactivarse en Node con la variable de entorno <code>API_LOG=0</code>.</li>
            {isDev ? (
              <li>
                Para publicar bajo <code>/out</code> en el dominio (por ejemplo <code>bocasion.com/out/</code>), en el repo del dashboard ejecuta{" "}
                <code>npm run export</code>: genera la carpeta <code>out/</code> con <code>BASE_PATH=/out</code> y copia API PHP y datos estáticos.
              </li>
            ) : (
              <li>
                Si eres <strong>Admin</strong> sin acceso al repositorio, coordina con <strong>Dev</strong> para secretos de sesión, exportación a{" "}
                <code>/out</code> y despliegue.
              </li>
            )}
          </ul>
        </article>
      );

    case "manual-usuarios":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Usuarios</h2>
            <p className={styles.chapterIntro}>
              Solo <strong>Admin</strong> y <strong>Dev</strong> entran aquí. Ambos ven el listado y la vista en solo lectura de las tablas Notion
              de cualquier usuario; las altas, ediciones y bajas de cuentas están reservadas al rol <strong>Dev</strong> en la interfaz.
            </p>
          </header>
          <figure className={styles.figure}>
            <div className={styles.figureMedia}>
              <ManualFigure
                file="usuarios.png"
                alt="Captura del listado de usuarios y acciones."
                fallback={<PreviewUsuarios />}
              />
            </div>
            <figcaption className={styles.caption}>
              Captura con rol Dev (botón Nuevo y acciones de fila); como Admin verías la misma tabla pero sin crear, editar ni eliminar.
            </figcaption>
          </figure>
          <ul className={styles.list}>
            <li>
              <strong>Admin:</strong> tabla de usuarios con rol y fechas; icono <strong>ojo</strong> para inspeccionar las pestañas Notion de esa
              persona y exportar esa vista a Excel o CSV. No aparecen el botón <strong>Nuevo</strong> ni los iconos de editar o eliminar filas.
            </li>
            <li>
              <strong>Dev:</strong> todo lo anterior más <strong>Nuevo</strong> (alta de usuario), edición de datos y borrado de cuentas salvo la
              cuenta protegida del usuario sistema <code>dev</code>.
            </li>
          </ul>
        </article>
      );

    case "manual-docs":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Esta documentación</h2>
            <p className={styles.chapterIntro}>
              Es el manual integrado en la aplicación: texto claro, capturas de pantalla cuando las generes y enlaces a los módulos.
            </p>
          </header>
          <ul className={styles.list}>
            <li>Úsalo como referencia cuando incorporas gente nueva o olvidas dónde está una acción.</li>
            <li>
              El índice solo lista capítulos según tu rol; Admin y Dev comparten Tickets y Notion avanzado, pero en Usuarios solo Dev gestiona
              altas y bajas desde la interfaz.
            </li>
            <li>
              Para fotos reales ejecuta <code>npm run docs:screenshots:install</code> y <code>npm run docs:screenshots</code> con tus variables{" "}
              <code>MANUAL_SCREENSHOT_USER</code> / <code>MANUAL_SCREENSHOT_PASSWORD</code>; por defecto las capturas se toman del sitio publicado{" "}
              <a href="https://www.bocasion.com/out/" target="_blank" rel="noreferrer">
                bocasion.com/out
              </a>{" "}
              (datos reales). Para localhost usa <code>MANUAL_SCREENSHOT_BASE_URL</code> —véase README del proyecto.
            </li>
          </ul>
          <div className={styles.quickLinks}>
            <Link href="/">Ir a Home</Link>
            {isStaff ? <Link href="/tickets">Ir a Tickets</Link> : null}
            <Link href="/notion">Ir a Notion</Link>
            <Link href="/analisis">Ir a Análisis</Link>
            {isStaff ? <Link href="/usuarios">Ir a Usuarios</Link> : null}
          </div>
        </article>
      );

    case "manual-acceso":
      return (
        <article className={styles.chapter} id={id} aria-labelledby={`${id}-title`}>
          <header className={styles.chapterHeader}>
            <h2 id={`${id}-title`}>Sesión y permisos</h2>
            <p className={styles.chapterIntro}>
              Acceso por usuario y contraseña validados en servidor. Tras un login correcto se establece una cookie segura (HttpOnly) que el
              navegador envía solo a tu mismo sitio; no sustituye los permisos de rol.
            </p>
          </header>
          <ul className={styles.list}>
            <li>No introduces credenciales en la barra de direcciones; el formulario envía el login por POST al backend.</li>
            <li>
              <strong>Cerrar sesión</strong> borra la cookie en servidor y la vista local; si tenías una sesión antigua solo en memoria del
              navegador, también se limpia.
            </li>
            <li>Tres niveles de rol controlan el menú lateral y los capítulos de este manual.</li>
            <li>Si la pantalla te muestra “Sin permisos”, tu rol no incluye esa URL.</li>
          </ul>
          <div className={styles.subBlock}>
            <h3>Qué incluye cada rol</h3>
            <ul className={styles.list}>
              <li>
                <strong>Usuario:</strong> Home, Análisis, Notion (compartir tablas propias; sin botón Áreas), Alertas, Documentación y manual sin
                Tickets, Usuarios ni Tests del repositorio.
              </li>
              <li>
                <strong>Admin:</strong> todo lo anterior más <strong>Tickets</strong> (mesa completa, igual que Dev), Notion con botón{" "}
                <strong>Áreas</strong>, y entrada a <strong>Usuarios</strong> en modo consulta (lista + vista Notion de otros, sin crear ni borrar
                cuentas desde la UI). Capítulo <em>Tests y calidad</em> orientado a operación junto a Dev.
              </li>
              <li>
                <strong>Dev:</strong> misma navegación y mismos permisos que Admin en Tickets y Notion; en <strong>Usuarios</strong> además alta,
                edición y baja de cuentas (salvo la cuenta <code>dev</code> protegida). Suele encargarse del build exportado a <code>/out</code>.
              </li>
            </ul>
          </div>
          {(isAdmin || isDev) && (
            <p className={styles.note}>
              Resumen rápido Admin vs Dev: la única diferencia en menú y pantallas es <strong>Usuarios</strong> (CRUD solo Dev); el resto de enlaces
              compartidos se comporta igual para ambos roles.
            </p>
          )}
          <p className={styles.note}>
            <FiCalendar size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
            Tras iniciar sesión, revisa el calendario y las preferencias de tema desde la barra superior para adaptar el panel a tu forma de
            trabajar.
          </p>
        </article>
      );

    default:
      return null;
  }
}
