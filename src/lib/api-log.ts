type ApiLogEntry = {
  ts: string;
  tag: string;
  ms?: number;
  method?: string;
  path?: string;
  status?: number;
  detail?: string;
  ip?: string | null;
};

/** JSON en una línea para agregadores / journalctl; desactivar con API_LOG=0 */
export function apiLog(tag: string, extra: Partial<ApiLogEntry> & Record<string, unknown> = {}) {
  if (process.env.API_LOG === "0") return;
  const row: Record<string, unknown> = { ts: new Date().toISOString(), tag, ...extra };
  console.log(JSON.stringify(row));
}
