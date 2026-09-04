import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { DATA_DIR } from "@/lib/data-dir";
import { getAuthFromRequest, requireStaffAuth } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const XLSX_PATH = path.join(process.cwd(), "..", "Programa Anual de Actividades 2026.xlsx");
const META_PATH = path.join(DATA_DIR, "programa-anual-meta.json");
const OVERRIDES_PATH = path.join(DATA_DIR, "programa-anual-overrides.json");
/** Seed del Excel en repo; solo lectura. Ediciones van a `.data/` (dev) o MySQL (prod). */
const ACTIVITIES_SEED_PATH = path.join(process.cwd(), "public", "data", "programa-anual-activities.json");

const MONTHS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"] as const;
type Month = typeof MONTHS[number];

export interface ActividadMeta {
  equipoAsociado?: string;
  fechaCompra?: string;
  costoCompra?: number;
  vidaUtilAnios?: number;
  proveedorEquipo?: string;
  notasCompra?: string;
}

export interface ActividadOverride {
  planeado?: Partial<Record<Month, boolean>>;
  realizado?: Partial<Record<Month, boolean>>;
  responsable?: string;
  frecuencia?: string;
  presupuesto?: string | null;
  actividad?: string;
  programa?: string;
  programaLabel?: string;
}

const STORE_PATH = path.join(DATA_DIR, "programa-anual-store.json");

interface StoreRow {
  id: string;
  actividad: string;
  frecuencia: string;
  responsable: string;
  presupuesto: string | null;
  programa: string;
  programaLabel: string;
  planeado: Record<Month, boolean>;
  realizado: Record<Month, boolean>;
  meta: ActividadMeta;
  excelPlaneado: Record<Month, boolean>;
  excelRealizado: Record<Month, boolean>;
  excelFrecuencia: string;
  excelResponsable: string;
  excelPresupuesto: string | null;
}

export interface Actividad {
  id: string;
  actividad: string;
  frecuencia: string;
  responsable: string;
  presupuesto: string | null;
  programa: string;
  programaLabel: string;
  planeado: Record<Month, boolean>;
  realizado: Record<Month, boolean>;
  totalPlaneado: number;
  totalRealizado: number;
  cumplimiento: number | null;
  alertas: string[];
  meta: ActividadMeta;
  // Depreciation (calculated)
  vidaAlcanzada: number | null;
  depreciacionPct: number | null;
  valorResidual: number | null;
  aniosRestantes: number | null;
}

const PROGRAMA_LABELS: Record<string, string> = {
  "OBJETIVO1":                  "Objetivo SSO",
  "OBJETIVO 2":                 "Capacitaciones SSO",
  "OBJETIVOS 3":                "Actividades SSO",
  "CALIDAD E INFRAESTRUCTURA":  "Calidad e Infraestructura",
};

function safe(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("=")) return null;
  return s;
}

function toId(programa: string, actividad: string): string {
  return `${programa}::${actividad}`.toLowerCase().replace(/\s+/g, "_").slice(0, 80);
}

// Sheet parsing config: [headerRow0idx, dataStart0idx, colAct, colFreq, colResp, colPresup, monthStartCol]
const SHEET_CFG: Record<string, [number, number, number, number, number, number | null, number]> = {
  "OBJETIVO1":                  [14, 17, 0, 1, 2, 3, 4],
  "OBJETIVO 2":                 [17, 20, 0, 1, 2, null, 3],
  "OBJETIVOS 3":                [17, 20, 0, 1, 2, null, 3],
  "CALIDAD E INFRAESTRUCTURA":  [7, 10, 0, 1, 3, 2, 4],
};

const SKIP_PREFIXES = ["P:", "R:", "ELABORADO", "P: ", "R: ", "%"];

function calcAlertas(act: Omit<Actividad, "alertas">): string[] {
  const alerts: string[] = [];
  const now = new Date();
  const cm = now.getMonth(); // 0-indexed
  const currentMonth = MONTHS[cm] as Month;
  const prevMonth = cm > 0 ? MONTHS[cm - 1] as Month : null;

  if (act.planeado[currentMonth] && !act.realizado[currentMonth]) {
    alerts.push("pendiente_mes_actual");
  }
  if (prevMonth && act.planeado[prevMonth] && !act.realizado[prevMonth]) {
    alerts.push("no_ejecutado_mes_anterior");
  }
  const nextMonth = cm < 11 ? MONTHS[cm + 1] as Month : null;
  if (nextMonth && act.planeado[nextMonth]) {
    alerts.push("programado_proximo_mes");
  }
  if (act.totalPlaneado > 0 && act.cumplimiento !== null && act.cumplimiento < 50) {
    alerts.push("bajo_cumplimiento");
  }
  if (act.totalPlaneado > 0 && act.totalRealizado === 0) {
    alerts.push("sin_ejecucion");
  }
  if (act.depreciacionPct !== null) {
    if (act.depreciacionPct >= 100) alerts.push("equipo_vida_vencida");
    else if (act.depreciacionPct >= 80) alerts.push("equipo_vida_critica");
    else if (act.depreciacionPct >= 60) alerts.push("equipo_vida_proxima");
  }
  if (act.meta.fechaCompra) {
    const fin = new Date(act.meta.fechaCompra);
    fin.setFullYear(fin.getFullYear() + (act.meta.vidaUtilAnios ?? 5));
    const diff = Math.floor((fin.getTime() - now.getTime()) / 86400000);
    if (diff < 0 && !alerts.includes("equipo_vida_vencida")) alerts.push("equipo_vida_vencida");
  }
  return alerts;
}

async function readMeta(): Promise<Record<string, ActividadMeta>> {
  try {
    const data = await fs.readFile(META_PATH, "utf-8");
    return JSON.parse(data) as Record<string, ActividadMeta>;
  } catch {
    return {};
  }
}

async function writeMeta(meta: Record<string, ActividadMeta>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

async function readOverrides(): Promise<Record<string, ActividadOverride>> {
  try {
    const data = await fs.readFile(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(data) as Record<string, ActividadOverride>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeOverrides(all: Record<string, ActividadOverride>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OVERRIDES_PATH, JSON.stringify(all, null, 2), "utf-8");
}

function recalcTotals(planeado: Record<Month, boolean>, realizado: Record<Month, boolean>) {
  const totalPlaneado = MONTHS.filter(m => planeado[m]).length;
  const totalRealizado = MONTHS.filter(m => realizado[m]).length;
  const cumplimiento = totalPlaneado > 0 ? Math.round((totalRealizado / totalPlaneado) * 100) : null;
  return { totalPlaneado, totalRealizado, cumplimiento };
}

function applyOverride(act: Omit<Actividad, "alertas">, override?: ActividadOverride): Omit<Actividad, "alertas"> {
  if (!override) return act;
  const planeado = { ...act.planeado, ...override.planeado } as Record<Month, boolean>;
  const realizado = { ...act.realizado, ...override.realizado } as Record<Month, boolean>;
  const totals = recalcTotals(planeado, realizado);
  return {
    ...act,
    planeado,
    realizado,
    responsable: override.responsable ?? act.responsable,
    frecuencia: override.frecuencia ?? act.frecuencia,
    presupuesto: override.presupuesto !== undefined ? override.presupuesto : act.presupuesto,
    ...totals,
  };
}

function enrichAct(base: Omit<Actividad, "alertas">): Actividad {
  return { ...base, alertas: calcAlertas(base) };
}

function calcDepreciation(meta: ActividadMeta, currentYear = 2026) {
  let vidaAlcanzada: number | null = null;
  let depreciacionPct: number | null = null;
  let valorResidual: number | null = null;
  let aniosRestantes: number | null = null;
  if (meta.fechaCompra && meta.vidaUtilAnios) {
    const compraYear = new Date(meta.fechaCompra).getFullYear();
    vidaAlcanzada = currentYear - compraYear;
    depreciacionPct = Math.min(100, Math.round((vidaAlcanzada / meta.vidaUtilAnios) * 100));
    aniosRestantes = meta.vidaUtilAnios - vidaAlcanzada;
    if (meta.costoCompra) {
      valorResidual = Math.max(0, meta.costoCompra * (1 - depreciacionPct / 100));
    }
  }
  return { vidaAlcanzada, depreciacionPct, valorResidual, aniosRestantes };
}

function emptyMonths(): Record<Month, boolean> {
  return Object.fromEntries(MONTHS.map(m => [m, false])) as Record<Month, boolean>;
}

function storeRowToActividad(row: StoreRow): Actividad {
  const totals = recalcTotals(row.planeado, row.realizado);
  const depr = calcDepreciation(row.meta);
  return enrichAct({
    id: row.id,
    actividad: row.actividad,
    frecuencia: row.frecuencia,
    responsable: row.responsable,
    presupuesto: row.presupuesto,
    programa: row.programa,
    programaLabel: row.programaLabel,
    planeado: row.planeado,
    realizado: row.realizado,
    meta: row.meta,
    ...totals,
    ...depr,
  });
}

async function readSeedMap() {
  try {
    const raw = JSON.parse(await fs.readFile(ACTIVITIES_SEED_PATH, "utf-8")) as Array<{
      id: string;
      planeado: Record<Month, boolean>;
      realizado: Record<Month, boolean>;
      frecuencia: string;
      responsable: string;
      presupuesto: string | null;
    }>;
    return new Map(raw.map(r => [r.id, r]));
  } catch {
    return new Map<string, {
      planeado: Record<Month, boolean>;
      realizado: Record<Month, boolean>;
      frecuencia: string;
      responsable: string;
      presupuesto: string | null;
    }>();
  }
}

async function buildStoreRows(): Promise<StoreRow[]> {
  const seedMap = await readSeedMap();
  const acts = await buildActividades();
  return acts.map(a => {
    const seed = seedMap.get(a.id);
    return {
      id: a.id,
      actividad: a.actividad,
      frecuencia: a.frecuencia,
      responsable: a.responsable,
      presupuesto: a.presupuesto,
      programa: a.programa,
      programaLabel: a.programaLabel,
      planeado: { ...a.planeado },
      realizado: { ...a.realizado },
      meta: { ...a.meta },
      excelPlaneado: seed?.planeado ? { ...seed.planeado } : { ...a.planeado },
      excelRealizado: seed?.realizado ? { ...seed.realizado } : { ...a.realizado },
      excelFrecuencia: seed?.frecuencia ?? a.frecuencia,
      excelResponsable: seed?.responsable ?? a.responsable,
      excelPresupuesto: seed?.presupuesto ?? a.presupuesto,
    };
  });
}

async function readStore(): Promise<StoreRow[] | null> {
  try {
    const data = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(data) as StoreRow[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveStore(rows: StoreRow[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(rows, null, 2), "utf-8");
}

async function ensureStore(): Promise<StoreRow[]> {
  const existing = await readStore();
  if (existing) return existing;
  const rows = await buildStoreRows();
  await saveStore(rows);
  return rows;
}

async function listActividades(): Promise<Actividad[]> {
  const store = await readStore();
  if (store) return store.map(storeRowToActividad);
  return buildActividades();
}

function normalizeMonths(src: Partial<Record<Month, boolean>> | Record<Month, boolean>): Record<Month, boolean> {
  const out = emptyMonths();
  MONTHS.forEach(m => {
    if (m in src) out[m] = Boolean(src[m]);
  });
  return out;
}

function applyPatchToRow(row: StoreRow, patch: ActividadOverride): StoreRow {
  const planeado = patch.planeado
    ? normalizeMonths({ ...row.planeado, ...patch.planeado })
    : row.planeado;
  const realizado = patch.realizado
    ? normalizeMonths({ ...row.realizado, ...patch.realizado })
    : row.realizado;
  return {
    ...row,
    actividad: patch.actividad?.trim() || row.actividad,
    programa: patch.programa?.trim() || row.programa,
    programaLabel: patch.programaLabel?.trim() || row.programaLabel,
    frecuencia: patch.frecuencia ?? row.frecuencia,
    responsable: patch.responsable ?? row.responsable,
    presupuesto: patch.presupuesto !== undefined ? patch.presupuesto : row.presupuesto,
    planeado,
    realizado,
  };
}

async function loadActivitiesFromJson(meta: Record<string, ActividadMeta>): Promise<Actividad[]> {
  const raw = JSON.parse(await fs.readFile(ACTIVITIES_SEED_PATH, "utf-8")) as Omit<Actividad, "alertas" | "meta" | "vidaAlcanzada" | "depreciacionPct" | "valorResidual" | "aniosRestantes">[];
  const overrides = await readOverrides();
  const currentYear = 2026;
  return raw.map(row => {
    const actMeta = meta[row.id] ?? {};
    let vidaAlcanzada: number | null = null;
    let depreciacionPct: number | null = null;
    let valorResidual: number | null = null;
    let aniosRestantes: number | null = null;
    if (actMeta.fechaCompra) {
      const compraYear = new Date(actMeta.fechaCompra).getFullYear();
      vidaAlcanzada = currentYear - compraYear;
      if (actMeta.vidaUtilAnios) {
        depreciacionPct = Math.min(100, Math.round((vidaAlcanzada / actMeta.vidaUtilAnios) * 100));
        aniosRestantes = actMeta.vidaUtilAnios - vidaAlcanzada;
        if (actMeta.costoCompra) {
          valorResidual = Math.max(0, actMeta.costoCompra * (1 - depreciacionPct / 100));
        }
      }
    }
    const base: Omit<Actividad, "alertas"> = {
      ...row,
      meta: actMeta,
      vidaAlcanzada,
      depreciacionPct,
      valorResidual,
      aniosRestantes,
    };
    return enrichAct(applyOverride(base, overrides[row.id]));
  });
}

async function parseXLSX(meta: Record<string, ActividadMeta>, overrides: Record<string, ActividadOverride>): Promise<Omit<Actividad, "alertas">[]> {
  const buf = await fs.readFile(XLSX_PATH);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const result: Omit<Actividad, "alertas">[] = [];

  for (const shName of Object.keys(SHEET_CFG)) {
    const ws = wb.Sheets[shName];
    if (!ws) continue;
    const [, dataStart, colAct, colFreq, colResp, colPresup, monthStart] = SHEET_CFG[shName];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

    for (let i = dataStart; i < raw.length; i++) {
      const row = raw[i] as unknown[];
      const actividad = safe(row[colAct]);
      if (!actividad) continue;
      if (SKIP_PREFIXES.some(p => actividad.toUpperCase().startsWith(p))) continue;

      const frecuencia = safe(row[colFreq]) ?? "";
      const responsable = colResp !== null ? safe(row[colResp]) ?? "" : "";
      const presupuesto = colPresup !== null ? safe(row[colPresup]) : null;

      const planeado = {} as Record<Month, boolean>;
      const realizado = {} as Record<Month, boolean>;
      MONTHS.forEach((m, mi) => {
        const pi = monthStart + mi * 2;
        const ri = monthStart + mi * 2 + 1;
        planeado[m] = Boolean(safe(row[pi]));
        realizado[m] = Boolean(safe(row[ri]));
      });

      const totalPlaneado = MONTHS.filter(m => planeado[m]).length;
      const totalRealizado = MONTHS.filter(m => realizado[m]).length;
      const cumplimiento = totalPlaneado > 0 ? Math.round((totalRealizado / totalPlaneado) * 100) : null;

      const id = toId(shName, actividad);
      const actMeta = meta[id] ?? {};

      const currentYear = 2026;
      let vidaAlcanzada: number | null = null;
      let depreciacionPct: number | null = null;
      let valorResidual: number | null = null;
      let aniosRestantes: number | null = null;

      if (actMeta.fechaCompra) {
        const compraYear = new Date(actMeta.fechaCompra).getFullYear();
        vidaAlcanzada = currentYear - compraYear;
        if (actMeta.vidaUtilAnios) {
          depreciacionPct = Math.min(100, Math.round((vidaAlcanzada / actMeta.vidaUtilAnios) * 100));
          aniosRestantes = actMeta.vidaUtilAnios - vidaAlcanzada;
          if (actMeta.costoCompra) {
            valorResidual = Math.max(0, actMeta.costoCompra * (1 - depreciacionPct / 100));
          }
        }
      }

      const base: Omit<Actividad, "alertas"> = {
        id,
        actividad,
        frecuencia,
        responsable,
        presupuesto,
        programa: shName,
        programaLabel: PROGRAMA_LABELS[shName] ?? shName,
        planeado,
        realizado,
        totalPlaneado,
        totalRealizado,
        cumplimiento,
        meta: actMeta,
        vidaAlcanzada,
        depreciacionPct,
        valorResidual,
        aniosRestantes,
      };

      result.push(applyOverride(base, overrides[id]));
    }
  }

  return result;
}

async function buildActividades(): Promise<Actividad[]> {
  const meta = await readMeta();
  const overrides = await readOverrides();
  try {
    await fs.access(XLSX_PATH);
    const fromXlsx = await parseXLSX(meta, overrides);
    return fromXlsx.map(enrichAct);
  } catch {
    return loadActivitiesFromJson(meta);
  }
}

export async function GET() {
  try {
    const actividades = await listActividades();
    return NextResponse.json(actividades);
  } catch (err) {
    console.error("/api/programa-anual error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!requireStaffAuth(auth)) {
    return NextResponse.json({ error: "Sin permisos. Solo administradores y desarrolladores pueden modificar." }, { status: 403 });
  }
  try {
    const body = await req.json() as {
      actividad?: string;
      programa?: string;
      programaLabel?: string;
      frecuencia?: string;
      responsable?: string;
      presupuesto?: string | null;
      planeado?: Partial<Record<Month, boolean>>;
      realizado?: Partial<Record<Month, boolean>>;
      meta?: ActividadMeta;
    };
    const actividad = body.actividad?.trim() ?? "";
    let programa = body.programa?.trim() ?? "";
    let programaLabel = body.programaLabel?.trim() ?? "";
    if (!actividad) return NextResponse.json({ error: "actividad requerida" }, { status: 400 });
    if (!programa && !programaLabel) return NextResponse.json({ error: "programa requerido" }, { status: 400 });
    if (!programaLabel) programaLabel = programa;
    if (!programa) programa = programaLabel.toUpperCase();

    const id = toId(programa, actividad);
    const rows = await ensureStore();
    if (rows.some(r => r.id === id)) {
      return NextResponse.json({ error: "Ya existe una actividad con el mismo programa y nombre" }, { status: 409 });
    }

    const planeado = normalizeMonths(body.planeado ?? {});
    const realizado = normalizeMonths(body.realizado ?? {});
    const frecuencia = body.frecuencia ?? "";
    const responsable = body.responsable ?? "";
    const presupuesto = body.presupuesto ?? null;
    const meta = body.meta ?? {};

    const row: StoreRow = {
      id,
      actividad,
      frecuencia,
      responsable,
      presupuesto,
      programa,
      programaLabel,
      planeado,
      realizado,
      meta,
      excelPlaneado: { ...planeado },
      excelRealizado: { ...realizado },
      excelFrecuencia: frecuencia,
      excelResponsable: responsable,
      excelPresupuesto: presupuesto,
    };
    rows.push(row);
    await saveStore(rows);
    return NextResponse.json({ ok: true, actividad: storeRowToActividad(row) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!requireStaffAuth(auth)) {
    return NextResponse.json({ error: "Sin permisos. Solo administradores y desarrolladores pueden modificar." }, { status: 403 });
  }
  try {
    const { id, meta: newMeta } = await req.json() as { id: string; meta: ActividadMeta };
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    const rows = await ensureStore();
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    rows[idx].meta = { ...rows[idx].meta, ...newMeta };
    await saveStore(rows);
    return NextResponse.json({ ok: true, meta: rows[idx].meta });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!requireStaffAuth(auth)) {
    return NextResponse.json({ error: "Sin permisos. Solo administradores y desarrolladores pueden modificar." }, { status: 403 });
  }
  try {
    const { id, patch } = await req.json() as { id: string; patch: ActividadOverride };
    if (!id || !patch || typeof patch !== "object") {
      return NextResponse.json({ error: "id y patch requeridos" }, { status: 400 });
    }
    if (patch.actividad !== undefined && !patch.actividad.trim()) {
      return NextResponse.json({ error: "actividad no puede estar vacía" }, { status: 400 });
    }
    const rows = await ensureStore();
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });
    rows[idx] = applyPatchToRow(rows[idx], patch);
    await saveStore(rows);
    return NextResponse.json({ ok: true, actividad: storeRowToActividad(rows[idx]) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = getAuthFromRequest(req);
  if (!requireStaffAuth(auth)) {
    return NextResponse.json({ error: "Sin permisos. Solo administradores y desarrolladores pueden modificar." }, { status: 403 });
  }
  try {
    const { id, scope } = await req.json() as { id: string; scope: "meta" | "override" | "actividad" };
    if (!id || (scope !== "meta" && scope !== "override" && scope !== "actividad")) {
      return NextResponse.json({ error: "id y scope (meta|override|actividad) requeridos" }, { status: 400 });
    }
    const rows = await ensureStore();
    const idx = rows.findIndex(r => r.id === id);
    if (idx < 0) return NextResponse.json({ error: "Actividad no encontrada" }, { status: 404 });

    if (scope === "actividad") {
      rows.splice(idx, 1);
      await saveStore(rows);
      return NextResponse.json({ ok: true });
    }

    if (scope === "meta") {
      rows[idx].meta = {};
      await saveStore(rows);
      return NextResponse.json({ ok: true });
    }

    rows[idx] = {
      ...rows[idx],
      planeado: { ...rows[idx].excelPlaneado },
      realizado: { ...rows[idx].excelRealizado },
      frecuencia: rows[idx].excelFrecuencia,
      responsable: rows[idx].excelResponsable,
      presupuesto: rows[idx].excelPresupuesto,
    };
    await saveStore(rows);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
