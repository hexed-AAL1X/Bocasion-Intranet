import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import {
  persistAllTaskAttachments,
  persistTaskAttachments,
  stripTasksForTransport,
  stripTaskForTransport,
} from "@/lib/notionAttachmentsServer";

export const runtime = "nodejs";

const storagePath = path.join(DATA_DIR, "tasks.json");

type Task = Record<string, unknown>;

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

const safeTabId = (tabId: string | null) => String(tabId || "").replace(/[^a-zA-Z0-9_-]/g, "") || "";

const getStoragePath = (request?: NextRequest) => {
  const tabId = request ? safeTabId(request.nextUrl.searchParams.get("tabId")) : "";
  return tabId ? path.join(DATA_DIR, `tasks.${tabId}.json`) : storagePath;
};

const tabIdFromRequest = (request: NextRequest) => safeTabId(request.nextUrl.searchParams.get("tabId"));

async function readTasks(filePath = storagePath): Promise<Task[]> {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if (errnoCode(err) === "ENOENT") {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify([], null, 2), "utf-8");
      return [];
    }
    throw err;
  }
}

async function writeTasks(tasks: Task[], filePath = storagePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");
}

async function maybeMigrateAttachments(tasks: Task[], tabId: string, filePath: string) {
  const before = JSON.stringify(tasks);
  await persistAllTaskAttachments(tasks, tabId);
  if (JSON.stringify(tasks) !== before) {
    await writeTasks(tasks, filePath);
  }
}

async function transportTasks(tasks: Task[], tabId: string, filePath: string) {
  await maybeMigrateAttachments(tasks, tabId, filePath);
  return stripTasksForTransport(tasks);
}

const generateId = () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const respondError = (err: unknown) => {
  console.error("/api/tasks error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET(request: NextRequest) {
  try {
    const tabId = tabIdFromRequest(request);
    const filePath = getStoragePath(request);
    const tasks = await readTasks(filePath);
    return NextResponse.json(await transportTasks(tasks, tabId, filePath));
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tabId = tabIdFromRequest(request);
    const filePath = getStoragePath(request);
    const tasks = await readTasks(filePath);

    if (Array.isArray(body)) {
      const newTasks = body.map((task: Task) => ({
        id: task.id || generateId(),
        usuario: String(task.usuario || "").trim(),
        area: String(task.area || "").trim(),
        actividad: String(task.actividad || "").trim(),
        fecha: String(task.fecha || "").trim(),
        estado: String(task.estado || "⏳ Programado").trim(),
        ...task,
      })).filter((t: Task) => t.actividad);

      if (!newTasks.length) {
        return NextResponse.json({ error: "Sin tareas válidas" }, { status: 400 });
      }

      for (const task of newTasks) {
        await persistTaskAttachments(task, tabId);
      }
      const finalTasks = [...newTasks, ...tasks];
      await writeTasks(finalTasks, filePath);
      return NextResponse.json(await transportTasks(finalTasks, tabId, filePath));
    }

    const payload = {
      id: body.id || generateId(),
      usuario: String(body.usuario || "").trim(),
      area: String(body.area || "").trim(),
      actividad: String(body.actividad || "").trim(),
      fecha: String(body.fecha || "").trim(),
      estado: String(body.estado || "⏳ Programado").trim(),
      ...body,
    };
    await persistTaskAttachments(payload, tabId);

    const finalTasks = [...tasks, payload];
    await writeTasks(finalTasks, filePath);
    return NextResponse.json(await transportTasks(finalTasks, tabId, filePath));
  } catch (err) {
    return respondError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    const tabId = tabIdFromRequest(request);
    const filePath = getStoragePath(request);
    const tasks = await readTasks(filePath);

    if (Array.isArray(payload)) {
      let updated = false;
      const indexMap = new Map<string, number>();
      tasks.forEach((task, index) => indexMap.set(`${task.id}`, index));
      const nextTasks = [...tasks];
      for (const raw of payload as Task[]) {
        const task = {
          id: raw.id || generateId(),
          usuario: String(raw.usuario || "").trim(),
          area: String(raw.area || "").trim(),
          actividad: String(raw.actividad || "").trim(),
          fecha: String(raw.fecha || "").trim(),
          estado: String(raw.estado || "⏳ Programado").trim(),
          ...raw,
        };
        const key = `${task.id}`;
        const idx = indexMap.get(key);
        if (idx === undefined) continue;
        await persistTaskAttachments(task, tabId);
        nextTasks[idx] = { ...nextTasks[idx], ...task };
        updated = true;
      }
      if (!updated) {
        return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
      }
      await writeTasks(nextTasks, filePath);
      return NextResponse.json(await transportTasks(nextTasks, tabId, filePath));
    }

    if (!payload?.id) {
      if (Array.isArray(payload?._reorder)) {
        const order = payload._reorder.map((id: unknown) => String(id));
        const byId = new Map(tasks.map((task) => [String(task.id), task]));
        const reordered: Task[] = [];
        for (const id of order) {
          const task = byId.get(id);
          if (task) {
            reordered.push(task);
            byId.delete(id);
          }
        }
        for (const task of byId.values()) reordered.push(task);
        await writeTasks(reordered, filePath);
        return NextResponse.json(await transportTasks(reordered, tabId, filePath));
      }
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }

    let updatedTask: Task | null = null;
    const nextTasks = [];
    for (const task of tasks) {
      if (task.id === payload.id) {
        const merged = { ...task, ...payload };
        await persistTaskAttachments(merged, tabId);
        updatedTask = merged;
        nextTasks.push(merged);
      } else {
        nextTasks.push(task);
      }
    }

    if (!updatedTask) {
      return NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 });
    }

    await writeTasks(nextTasks, filePath);
    const transport = await transportTasks(nextTasks, tabId, filePath);
    const updatedTransport = transport.find((task) => task.id === payload.id) ?? stripTaskForTransport(updatedTask);
    return NextResponse.json({ ok: true, task: updatedTransport, tasks: transport });
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = await request.json();
    if (!payload?.id) {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }
    const tabId = tabIdFromRequest(request);
    const filePath = getStoragePath(request);
    const tasks = await readTasks(filePath);
    const filtered = tasks.filter((task) => task.id !== payload.id);
    await writeTasks(filtered, filePath);
    return NextResponse.json(await transportTasks(filtered, tabId, filePath));
  } catch (err) {
    return respondError(err);
  }
}
