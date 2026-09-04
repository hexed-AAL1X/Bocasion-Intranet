import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const storagePath = path.join(DATA_DIR, "events.json");

type CalEvent = { id: string; title: string; date: string };

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

const readEvents = async (): Promise<CalEvent[]> => {
  try {
    const data = await fs.readFile(storagePath, "utf-8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") {
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, JSON.stringify([], null, 2), "utf-8");
      return [];
    }
    throw err;
  }
};

const writeEvents = async (events: CalEvent[]) => {
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, JSON.stringify(events, null, 2), "utf-8");
};

const respondError = (err: unknown) => {
  console.error("/api/events error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET() {
  try {
    const events = await readEvents();
    return NextResponse.json(events);
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const title = typeof payload?.title === "string" ? payload.title.trim() : "";
    const date = typeof payload?.date === "string" ? payload.date.trim() : "";
    if (!title || !date) {
      return NextResponse.json({ error: "title y date son requeridos" }, { status: 400 });
    }
    const events = await readEvents();
    const newEvent: CalEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title,
      date,
    };
    events.push(newEvent);
    await writeEvents(events);
    return NextResponse.json(events);
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = await request.json();
    const id = typeof payload?.id === "string" ? payload.id : "";
    if (!id) {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }
    const events = await readEvents();
    const nextEvents = events.filter((event) => event.id !== id);
    await writeEvents(nextEvents);
    return NextResponse.json(nextEvents);
  } catch (err) {
    return respondError(err);
  }
}
