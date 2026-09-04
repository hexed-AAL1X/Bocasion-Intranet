import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export const runtime = "nodejs";

const storagePath = path.join(DATA_DIR, "columns.json");

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

type Column = {
  title: string;
  savedTitle: string;
  type: string;
  icon?: string;
  hidden: boolean;
  pinned: boolean;
  fit: boolean;
  filter: boolean;
  sort: string;
  group: boolean;
  calculate: string;
  width?: number;
  relationSource?: string;
};

type ColumnsData = {
  baseColumns: Column[];
  customColumns: Column[];
};

const safeTabId = (tabId: string | null) => String(tabId || "").replace(/[^a-zA-Z0-9_-]/g, "") || "";

const getStoragePath = (request?: NextRequest) => {
  const tabId = request ? safeTabId(request.nextUrl.searchParams.get("tabId")) : "";
  return tabId ? path.join(DATA_DIR, `columns.${tabId}.json`) : storagePath;
};

const getDefaultColumns = (): ColumnsData => ({
  baseColumns: [
    { title: "Personas", savedTitle: "Usuario", type: "Personas", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
    { title: "Relación", savedTitle: "Área", type: "Relación", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
    { title: "Texto", savedTitle: "Texto", type: "Texto", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
    { title: "Fecha", savedTitle: "Fecha", type: "Fecha", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
    { title: "Casilla", savedTitle: "Casilla", type: "Casilla", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
    { title: "Estado", savedTitle: "Estado", type: "Estado", hidden: false, pinned: false, fit: false, filter: false, sort: "", group: false, calculate: "" },
  ],
  customColumns: [],
});

async function readColumns(filePath = storagePath): Promise<ColumnsData> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    // Si el archivo existe pero no tiene columnas base, aplicar defaults
    if (!Array.isArray(parsed?.baseColumns) || parsed.baseColumns.length === 0) {
      const defaults = getDefaultColumns();
      const fixed = { ...defaults, customColumns: Array.isArray(parsed?.customColumns) ? parsed.customColumns : [] };
      await fs.writeFile(filePath, JSON.stringify(fixed, null, 2), "utf-8");
      return fixed;
    }
    return parsed;
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const defaultData = getDefaultColumns();
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), "utf-8");
      return defaultData;
    }
    throw err;
  }
}

async function writeColumns(data: ColumnsData, filePath = storagePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

const respondError = (err: unknown) => {
  console.error("/api/columns error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET(request: NextRequest) {
  try {
    const columns = await readColumns(getStoragePath(request));
    return NextResponse.json(columns);
  } catch (err) {
    return respondError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    const filePath = getStoragePath(request);
    
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Estructura inválida" }, { status: 400 });
    }

    const data: ColumnsData = {
      baseColumns: Array.isArray(payload.baseColumns) ? payload.baseColumns : [],
      customColumns: Array.isArray(payload.customColumns) ? payload.customColumns : [],
    };

    await writeColumns(data, filePath);
    return NextResponse.json(data);
  } catch (err) {
    return respondError(err);
  }
}
