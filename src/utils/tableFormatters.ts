/**
 * Utilidades de formateo compartidas entre páginas de tabla (equipos, rrhh, etc.)
 */

/** Formatea un valor de celda genérico: null/"" → "—", números con locale pe. */
export function cell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toLocaleString("es-PE", { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** Formatea una fecha ISO a fecha+hora en formato peruano. */
export function formatLastUpdated(iso?: string): string {
  if (!iso) return "Sin sincronizar";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  });
}

/** Formatea un valor numérico o string como moneda sol peruano. */
export function formatMoney(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && v.includes("S/")) return v;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
