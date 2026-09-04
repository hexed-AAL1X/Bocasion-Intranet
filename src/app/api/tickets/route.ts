import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const storagePath = path.join(DATA_DIR, "tickets.json");

type TicketRow = Record<string, unknown>;

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v);
}

async function readTickets(): Promise<TicketRow[]> {
  try {
    const data = await fs.readFile(storagePath, "utf-8");
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? (parsed as TicketRow[]) : [];
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") return [];
    throw err;
  }
}

async function writeTickets(tickets: TicketRow[]) {
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, JSON.stringify(tickets, null, 2), "utf-8");
}

const normalizeDate = (value?: string) => {
  if (!value) return "";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const ensureTicket = (raw: TicketRow): TicketRow => {
  const nowIso = new Date().toISOString();
  const registro = normalizeDate(str(raw["F. Registro"] ?? raw["fecha_registro"])) || nowIso;
  const altaRaw = str(raw["F. Alta"] ?? raw["fecha_respuesta"]);
  const alta = altaRaw ? normalizeDate(altaRaw) : "";
  const number = Number(raw["Nº ticket"] ?? raw["ticket_id"] ?? Math.round(Date.now()));
  const descripcion = str(raw["Incidencia"] ?? raw["descripcion_detallada"]);
  const respuesta = str(raw["Solución"] ?? raw["Solucion"] ?? raw["respuesta_detallada"]);
  const motivo = str(raw["Motivo"] ?? raw["motivo"]);
  const responsable = str(raw["Usuario a Cargo"] ?? raw["responsable"]);

  return {
    ...raw,
    "Nº ticket": number,
    ticket_id: number,
    "F. Registro": registro,
    fecha_registro: registro,
    ...(alta
      ? {
          "F. Alta": alta,
          fecha_respuesta: alta,
        }
      : {}),
    "Días": Number(raw["Días"] ?? raw["dias"] ?? 0),
    Incidencia: descripcion,
    descripcion_detallada: descripcion,
    "Solución": respuesta,
    respuesta_detallada: respuesta,
    Motivo: motivo,
    Estado: str(raw["Estado"] ?? raw["estado"]) || "sin estado",
    Contacto: str(raw["Contacto"] ?? raw["contacto"]),
    "Usuario a Cargo": responsable,
  };
};

const ticketsAreEqual = (a: TicketRow, b: TicketRow) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    if (typeof va === "object" || typeof vb === "object") {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    } else if (`${va ?? ""}` !== `${vb ?? ""}`) {
      return false;
    }
  }
  return true;
};

const dedupeTickets = (list: TicketRow[]) => {
  const seen = new Set<string>();
  const result: TicketRow[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ticket = list[i];
    const key = `${ticket["Nº ticket"] ?? ticket["ticket_id"] ?? ""}`.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.unshift(ticket);
  }
  return result;
};

const respondError = (err: unknown) => {
  console.error("/api/tickets error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET() {
  try {
    const tickets = await readTickets();
    return NextResponse.json(tickets);
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tickets = await readTickets();

    if (Array.isArray(body)) {
      const pending = new Map<string, TicketRow>();
      body.forEach((raw: unknown) => {
        const ticket = ensureTicket(raw as TicketRow);
        if (!ticket.Incidencia || !ticket.Estado) return;
        const key = `${ticket["Nº ticket"]}`;
        if (!key) return;
        pending.set(key, ticket);
      });

      if (!pending.size) {
        return NextResponse.json({ error: "Sin tickets nuevos" }, { status: 409 });
      }

      const creations: TicketRow[] = [];
      const updated = new Map<number, TicketRow>();

      pending.forEach((ticket, key) => {
        const index = tickets.findIndex((existing) => `${existing["Nº ticket"]}` === key);
        if (index === -1) {
          creations.push(ticket);
          return;
        }
        if (ticketsAreEqual(tickets[index], ticket)) {
          return;
        }
        updated.set(index, ticket);
      });

      if (!creations.length && !updated.size) {
        return NextResponse.json({ error: "Sin tickets nuevos o cambios" }, { status: 409 });
      }

      const nextTickets = [...tickets];
      updated.forEach((ticket, index) => {
        nextTickets[index] = { ...nextTickets[index], ...ticket };
      });
      const finalTickets = dedupeTickets([...creations, ...nextTickets]);
      await writeTickets(finalTickets);
      return NextResponse.json(finalTickets);
    }

    const payload = ensureTicket(body as TicketRow);
    if (!payload.Incidencia || !payload.Estado) {
      return NextResponse.json({ error: "Incidencia y Estado son requeridos" }, { status: 400 });
    }
    if (tickets.some((t) => t["Nº ticket"] == payload["Nº ticket"])) {
      return NextResponse.json({ error: "Nº ticket duplicado" }, { status: 409 });
    }
    tickets.unshift(payload);
    await writeTickets(tickets);
    return NextResponse.json(tickets);
  } catch (err) {
    return respondError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    const tickets = await readTickets();
    if (Array.isArray(payload)) {
      let updated = false;
      const indexMap = new Map<string, number>();
      tickets.forEach((ticket, index) => indexMap.set(`${ticket["Nº ticket"]}`, index));
      const nextTickets = [...tickets];
      payload.forEach((raw: unknown) => {
        const ticket = ensureTicket(raw as TicketRow);
        const key = `${ticket["Nº ticket"]}`;
        if (!key) return;
        const idx = indexMap.get(key);
        if (idx === undefined) return;
        nextTickets[idx] = { ...nextTickets[idx], ...ticket };
        updated = true;
      });
      if (!updated) {
        return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
      }
      await writeTickets(nextTickets);
      return NextResponse.json(nextTickets);
    }

    if (!payload?.["Nº ticket"]) {
      return NextResponse.json({ error: "Nº ticket requerido" }, { status: 400 });
    }
    let updated = false;
    const nextTickets = tickets.map((ticket) => {
      if (ticket["Nº ticket"] == payload["Nº ticket"]) {
        updated = true;
        return { ...ticket, ...payload };
      }
      return ticket;
    });
    if (!updated) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }
    await writeTickets(nextTickets);
    return NextResponse.json(nextTickets);
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Soporta id como query param (?id=X) o en el body ({ id: X })
    const url = new URL(request.url);
    const idFromQuery = url.searchParams.get("id");

    let resolvedId: string | number | undefined = idFromQuery ?? undefined;
    if (resolvedId === undefined) {
      try {
        const payload = await request.json();
        resolvedId = payload?.id;
      } catch {
        // body vacío cuando el id viene por query string
      }
    }

    if (resolvedId === undefined || resolvedId === null || `${resolvedId}` === "") {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }

    const tickets = await readTickets();
    const filtered = tickets.filter((ticket) => `${ticket["Nº ticket"]}` !== `${resolvedId}`);
    await writeTickets(filtered);
    return NextResponse.json(filtered);
  } catch (err) {
    return respondError(err);
  }
}
