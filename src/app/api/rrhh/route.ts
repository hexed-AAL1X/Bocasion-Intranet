import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SHARE_URL =
  process.env.RRHH_ONEDRIVE_SHARE ||
  "https://1drv.ms/x/c/2244DF84B1EE0E79/IQC_rV8gf0tQSaricLI9c70DAasEXcJQYRfqzYo_sz9x-YU?e=hONCc7";
const SOURCE_NAME = "BUK_RRHH 1.xlsx";
const DATA_PATH = path.join(process.cwd(), "public", "data", "rrhh.json");
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

function sheetTable(wb: XLSX.WorkBook, name: string): SheetTable {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Falta la hoja "${name}"`);
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  if (rows.length < 3) return [];
  const headers = (rows[2] as (string | number | null)[]).map((h, i) => {
    const label = String(h ?? "").trim();
    return label || `col_${i}`;
  });
  const out: SheetTable = [];
  for (let r = 3; r < rows.length; r++) {
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

function sheetKv(wb: XLSX.WorkBook, name: string): Record<string, unknown> {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Falta la hoja "${name}"`);
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  const out: Record<string, unknown> = {};
  let started = false;
  for (const row of rows) {
    const k = String(row[0] ?? "").trim();
    const v = row[1] ?? null;
    if (!started) {
      if (k.toLowerCase() === "indicador") started = true;
      continue;
    }
    if (!k) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function parseWorkbook(buf: Buffer): Record<string, unknown> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  return {
    resumen: sheetKv(wb, "Resumen RRHH"),
    parametrosLegales: sheetTable(wb, "Parámetros Legales"),
    colaboradores: sheetTable(wb, "Colaboradores"),
    directorio: sheetTable(wb, "Directorio"),
    cargos: sheetTable(wb, "Cargos"),
    puestos: sheetTable(wb, "Puestos de Trabajo"),
    areas: sheetTable(wb, "Áreas"),
    licencias: sheetTable(wb, "Licencias"),
    comprobantes: sheetTable(wb, "Comprobantes de Pago"),
    itemsRemuneracion: sheetTable(wb, "Ítems Remuneración"),
    procesosNomina: sheetTable(wb, "Procesos Nómina"),
  };
}

function collectCookies(res: Response, jar: Map<string, string>) {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean) as string[];
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
      headers: {
        "User-Agent": UA,
        Cookie: cookieHeader(jar),
      },
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

  let base = "https://onedrive.live.com/personal/2244DF84B1EE0E79";
  const baseMatch =
    finalUrl.match(/(https:\/\/onedrive\.live\.com\/personal\/[A-Fa-f0-9]+)/) ||
    html.match(/(https:\/\/[^/"']+\/personal\/[A-Fa-f0-9]+)/);
  if (baseMatch) base = baseMatch[1];

  const downloadUrl = `${base}/_layouts/15/download.aspx?UniqueId=${encodeURIComponent(uid)}`;
  const fileRes = await fetch(downloadUrl, {
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader(jar),
    },
  });
  const ab = await fileRes.arrayBuffer();
  const buf = Buffer.from(ab);
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
    if (!data) return json({ ok: false, error: "Sin datos RRHH. Ejecuta sync." }, 404);
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error RRHH" }, 500);
  }
}

export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "sync";
  try {
    if (action !== "sync") {
      return json({ ok: false, error: "Acción no soportada" }, 400);
    }
    const data = await sync();
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Error RRHH" }, 500);
  }
}
