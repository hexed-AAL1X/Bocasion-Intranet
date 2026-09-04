import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHARE_URL =
  process.env.IT_ONEDRIVE_SHARE ||
  "https://1drv.ms/x/c/83b330b7dec9e4be/IQCdkBXRi7QuS4G4FZmQZKgNATRZ9Qo974fUIXpbWF6fyrk?e=wcWCEJ";
const SOURCE_NAME = "Inventario Equipos IT.xlsx";
const DATA_PATH = path.join(process.cwd(), "public", "data", "it-equipos.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type SheetTable = Record<string, unknown>[];

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

async function readCache(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeCache(data: Record<string, unknown>) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify(data), "utf8");
}

function normHeader(h: unknown, i: number): string {
  const label = String(h ?? "")
    .trim()
    .replace(/:+$/, "")
    .trim();
  return label || `col_${i}`;
}

function sheetTable(wb: XLSX.WorkBook, name: string, headerRow = 0): SheetTable {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Falta la hoja "${name}"`);
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  if (rows.length <= headerRow) return [];
  const headers = (rows[headerRow] as (string | number | null)[]).map((h, i) => normHeader(h, i));
  const out: SheetTable = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as (string | number | null)[];
    const rec: Record<string, unknown> = {};
    let empty = true;
    headers.forEach((key, i) => {
      let v = row[i] ?? null;
      if (typeof v === "string") v = v.trim();
      if (v !== null && v !== "") empty = false;
      rec[key] = v === "" ? null : v;
    });
    if (!empty) out.push(rec);
  }
  return out;
}

function infraLocales(wb: XLSX.WorkBook): SheetTable {
  const sheet = wb.Sheets["Hoja2"];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  let headerRow = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if ((rows[i] as (string | number | null)[]).some((c) => String(c ?? "").trim().toUpperCase() === "LOCAL")) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) return [];
  const headers = (rows[headerRow] as (string | number | null)[]).map((h, i) =>
    String(h ?? "").trim() || `col_${i}`
  );
  const localIdx = headers.findIndex((h) => h.toUpperCase() === "LOCAL");
  const routerIdx = headers.findIndex((h) => h.toUpperCase() === "ROUTER");
  const telIdx = headers.findIndex((h) => ["TELEFONO", "TELÉFONO"].includes(h.toUpperCase()));
  if (localIdx < 0) return [];

  const out: SheetTable = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] as (string | number | null)[];
    const local = String(row[localIdx] ?? "").trim();
    if (!local) continue;
    out.push({
      LOCAL: local,
      ROUTER: routerIdx >= 0 ? row[routerIdx] ?? null : null,
      TELEFONO: telIdx >= 0 ? row[telIdx] ?? null : null,
    });
  }
  return out;
}

function buildResumen(equipos: SheetTable) {
  const tipos: Record<string, number> = {};
  const locales: Record<string, number> = {};
  const marcas: Record<string, number> = {};
  let bajas = 0;
  let conCodigo = 0;

  for (const e of equipos) {
    if (e["CÓDIGO AF"]) conCodigo++;
    const tipo = String(e["TIPO EQUIPO"] ?? "Sin tipo").trim().toUpperCase() || "SIN TIPO";
    tipos[tipo] = (tipos[tipo] ?? 0) + 1;
    const local = String(e["LOCAL O ÁREA"] ?? "Sin local").trim() || "Sin local";
    locales[local] = (locales[local] ?? 0) + 1;
    const marca = String(e["MARCA"] ?? "Sin marca").trim().toUpperCase() || "SIN MARCA";
    marcas[marca] = (marcas[marca] ?? 0) + 1;
    if (String(e["OBSERVACIONES"] ?? "").toUpperCase().includes("BAJA")) bajas++;
  }

  const sortDesc = (obj: Record<string, number>) =>
    Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));

  return {
    totalEquipos: equipos.length,
    conCodigo,
    bajas,
    tipos: sortDesc(tipos),
    locales: sortDesc(locales),
    marcas: Object.fromEntries(Object.entries(sortDesc(marcas)).slice(0, 25)),
  };
}

function parseWorkbook(buf: Buffer): Record<string, unknown> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  if (!wb.Sheets["BD-EQUIPOS TECNOLOGICOS"]) {
    throw new Error('Falta la hoja "BD-EQUIPOS TECNOLOGICOS"');
  }
  const equipos = sheetTable(wb, "BD-EQUIPOS TECNOLOGICOS", 0);
  const visitasLocales = wb.Sheets["VISITA LOCALES"] ? sheetTable(wb, "VISITA LOCALES", 0) : [];
  return {
    equipos,
    visitasLocales,
    infraLocales: infraLocales(wb),
    resumen: buildResumen(equipos),
  };
}

function collectCookies(res: Response, jar: Map<string, string>) {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  for (const raw of list) {
    const part = raw.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function downloadXlsx(shareUrl: string): Promise<Buffer> {
  const jar = new Map<string, string>();
  let url = shareUrl;
  let html = "";
  let finalUrl = shareUrl;

  for (let i = 0; i < 10; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA, Cookie: cookieHeader(jar) },
    });
    collectCookies(res, jar);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirect sin Location (HTTP ${res.status})`);
      url = new URL(loc, url).toString();
      continue;
    }
    html = await res.text();
    finalUrl = url;
    if (!res.ok) throw new Error(`No se pudo abrir el enlace compartido (HTTP ${res.status})`);
    break;
  }

  const uid =
    html.match(/download\.aspx\?UniqueId=([a-f0-9-]{36})/i)?.[1] ||
    finalUrl.match(/sourcedoc=%7B([a-f0-9-]{36})%7D/i)?.[1] ||
    finalUrl.match(/sourcedoc=\{([a-f0-9-]{36})\}/i)?.[1];

  if (!uid) {
    throw new Error("No se encontró UniqueId del Excel. ¿El enlace sigue siendo público?");
  }

  let base = "https://onedrive.live.com/personal/83b330b7dec9e4be";
  const baseMatch =
    finalUrl.match(/(https:\/\/onedrive\.live\.com\/personal\/[A-Fa-f0-9]+)/) ||
    html.match(/(https:\/\/[^/"']+\/personal\/[A-Fa-f0-9]+)/);
  if (baseMatch) base = baseMatch[1];

  const downloadUrl = `${base}/_layouts/15/download.aspx?UniqueId=${encodeURIComponent(uid)}`;
  const fileRes = await fetch(downloadUrl, {
    headers: { "User-Agent": UA, Cookie: cookieHeader(jar) },
  });
  const buf = Buffer.from(await fileRes.arrayBuffer());
  if (!fileRes.ok) throw new Error(`Descarga falló (HTTP ${fileRes.status})`);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("La descarga no es un XLSX válido (¿permisos del enlace?)");
  }
  return buf;
}

async function sync() {
  const buf = await downloadXlsx(SHARE_URL);
  const parsed = parseWorkbook(buf);
  const payload = {
    ...parsed,
    lastUpdated: new Date().toISOString(),
    source: SOURCE_NAME,
    shareUrl: SHARE_URL,
  };
  await writeCache(payload);
  return payload;
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "data";
  try {
    if (action === "meta") {
      const data = await readCache();
      return json({
        ok: true,
        lastUpdated: data?.lastUpdated ?? null,
        source: data?.source ?? SOURCE_NAME,
      });
    }
    if (action === "sync") {
      const data = await sync();
      return json({ ok: true, data });
    }
    const data = await readCache();
    if (!data) return json({ ok: false, error: "Sin datos de equipos. Ejecuta sync." }, 404);
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error equipos IT" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "sync";
  try {
    if (action !== "sync") return json({ ok: false, error: "Acción no soportada" }, 400);
    const data = await sync();
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error equipos IT" }, 500);
  }
}
