/** En cliente: coincide con NEXT_PUBLIC_BASE_PATH del build (export con BASE_PATH=/out → prefijo /out en APIs estáticas). En dev suele ser "". */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const isLoopback = (value?: string) => {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
};

const withBase = (relative: string) => {
  if (relative.startsWith("http")) return relative;
  return `${BASE_PATH}${relative.startsWith("/") ? relative : `/${relative}`}`;
};

export const resolveTicketsApi = () => {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && !isLoopback(envUrl)) return envUrl;
  if (process.env.NODE_ENV === "development") {
    return envUrl ?? "http://127.0.0.1:8010/api/tickets.php";
  }
  return withBase("/api/tickets.php");
};

export const resolveEventsApi = () => {
  const envUrl = process.env.NEXT_PUBLIC_EVENTS_API;
  if (envUrl && !isLoopback(envUrl)) return envUrl;
  if (process.env.NODE_ENV === "development") {
    return envUrl ?? "http://127.0.0.1:8010/api/events.php";
  }
  return withBase("/api/events.php");
};

export const resolveDataPath = (relative: string) => withBase(relative.startsWith("/") ? relative : `/${relative}`);

/** Cola de sincronización Navasoft (PHP en el mismo hosting que tickets.php) */
export const resolveNavasoftApi = () => {
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:8010/api/navasoft.php";
  }
  return withBase("/api/navasoft.php");
};

export const resolveUsersApi = () =>
  process.env.NODE_ENV === "development" ? "/api/users" : withBase("/api/users.php");

/** Sesión: dev usa GET /api/users?action=session; export estático usa users.php?action=session */
export const resolveSessionApi = () => {
  if (process.env.NODE_ENV === "development") return "/api/users?action=session";
  const base = withBase("/api/users.php");
  return base.includes("?") ? `${base}&action=session` : `${base}?action=session`;
};

export const resolveNotionTabsApi = () =>
  process.env.NODE_ENV === "development" ? "/api/notion-tabs" : withBase("/api/notion-tabs.php");

export const resolveColumnsApi = () =>
  process.env.NODE_ENV === "development" ? "/api/columns" : withBase("/api/columns.php");

export const resolveTasksApi = () =>
  process.env.NODE_ENV === "development" ? "/api/tasks" : withBase("/api/tasks.php");

export const resolveMessagesApi = () =>
  process.env.NODE_ENV === "development" ? "/api/messages" : withBase("/api/messages.php");

export const resolveSharesApi = () =>
  process.env.NODE_ENV === "development" ? "/api/notion-shares" : withBase("/api/notion-shares.php");

export const resolveNotionHistoryApi = () =>
  process.env.NODE_ENV === "development" ? "/api/notion-history" : withBase("/api/notion-history.php");

export const resolveProgramaAnualApi = () =>
  process.env.NODE_ENV === "development" ? "/api/programa-anual" : withBase("/api/programa-anual.php");

export const resolveNotionAttachmentsApi = () =>
  process.env.NODE_ENV === "development" ? "/api/notion-attachments" : withBase("/api/notion-attachments.php");

/** RRHH: Excel OneDrive → JSON (dev: Next route; prod export: PHP) */
export const resolveRrhhApi = () => {
  if (process.env.NODE_ENV === "development") {
    return process.env.NEXT_PUBLIC_RRHH_API ?? "/api/rrhh";
  }
  return withBase("/api/rrhh.php");
};

/** IT equipos: Excel OneDrive → JSON (dev: Next route; prod export: PHP) */
export const resolveItEquiposApi = () => {
  if (process.env.NODE_ENV === "development") {
    return process.env.NEXT_PUBLIC_IT_EQUIPOS_API ?? "/api/it-equipos";
  }
  return withBase("/api/it-equipos.php");
};
