import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { SESSION_COOKIE_NAME, getSessionSecret, verifySessionToken } from "@/lib/session-cookie";

export const runtime = "nodejs";

type NotionTab = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  /** Si true, la pestaña va primero y solo se reordena entre fijadas */
  pinned?: boolean;
};

type TabsData = {
  activeTabId: string;
  tabs: NotionTab[];
  trash: NotionTab[];
};

const TRASH_RETENTION_DAYS = 15;
const dataDir = DATA_DIR;
const legacyColumnsPath = path.join(dataDir, "columns.json");
const legacyTasksPath = path.join(dataDir, "tasks.json");

function getAuthUserId(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  return typeof payload?.id === "string" ? payload.id : null;
}

function getAuthUserRole(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token, getSessionSecret());
  return typeof payload?.role === "string" ? payload.role : null;
}

const safeId = (id: string | null) => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");

const getTabsPath = (userId: string) => {
  const safe = safeId(userId);
  return safe ? path.join(dataDir, `notion-tabs.${safe}.json`) : path.join(dataDir, "notion-tabs.json");
};

const getUserId = (request: NextRequest) => safeId(request.nextUrl.searchParams.get("userId"));

const defaultTabId = "notion_default";
const generateId = () => `notion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function errnoCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

async function ensureLegacyCopies(tabId: string) {
  const tabColumnsPath = path.join(dataDir, `columns.${tabId}.json`);
  const tabTasksPath = path.join(dataDir, `tasks.${tabId}.json`);

  try {
    await fs.access(tabColumnsPath);
  } catch {
    try {
      const legacyColumns = await fs.readFile(legacyColumnsPath, "utf-8");
      await fs.writeFile(tabColumnsPath, legacyColumns, "utf-8");
    } catch {
      await fs.writeFile(tabColumnsPath, JSON.stringify({ baseColumns: [], customColumns: [] }, null, 2), "utf-8");
    }
  }

  try {
    await fs.access(tabTasksPath);
  } catch {
    try {
      const legacyTasks = await fs.readFile(legacyTasksPath, "utf-8");
      await fs.writeFile(tabTasksPath, legacyTasks, "utf-8");
    } catch {
      await fs.writeFile(tabTasksPath, JSON.stringify([], null, 2), "utf-8");
    }
  }
}

async function createEmptyTabFiles(tabId: string) {
  const tabColumnsPath = path.join(dataDir, `columns.${tabId}.json`);
  const tabTasksPath = path.join(dataDir, `tasks.${tabId}.json`);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tabTasksPath, JSON.stringify([], null, 2), "utf-8");
  // columns API will auto-create with defaults when the file doesn't exist,
  // but we write an empty shell so readColumns returns getDefaultColumns()
  try { await fs.access(tabColumnsPath); } catch {
    // leave absent – columns API creates defaults on first GET
  }
}

async function deleteTabFiles(tabId: string) {
  const safe = String(tabId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return;
  for (const prefix of ["tasks", "columns"]) {
    try { await fs.unlink(path.join(dataDir, `${prefix}.${safe}.json`)); } catch { /* ignore */ }
  }
}

async function readTabJsonFile(kind: "columns" | "tasks", tabId: string): Promise<unknown> {
  const safe = safeId(tabId);
  const p = path.join(dataDir, `${kind}.${safe}.json`);
  try {
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return kind === "columns" ? { baseColumns: [], customColumns: [] } : [];
  }
}

async function writeTabJsonFile(kind: "columns" | "tasks", tabId: string, data: unknown) {
  const safe = safeId(tabId);
  if (!safe) return;
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `${kind}.${safe}.json`), JSON.stringify(data, null, 2), "utf-8");
}

function purgeExpiredTrash(trash: NotionTab[]): { kept: NotionTab[]; expired: NotionTab[] } {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept: NotionTab[] = [];
  const expired: NotionTab[] = [];
  for (const tab of trash) {
    if (tab.trashedAt && new Date(tab.trashedAt).getTime() < cutoff) {
      expired.push(tab);
    } else {
      kept.push(tab);
    }
  }
  return { kept, expired };
}

function dedupeTabs(tabs: NotionTab[]): NotionTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (!tab?.id || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

function normalizeTabsOrder(tabs: NotionTab[]): NotionTab[] {
  const pinned: NotionTab[] = [];
  const unpinned: NotionTab[] = [];
  for (const t of tabs) {
    if (t.pinned === true) pinned.push(t);
    else unpinned.push(t);
  }
  return [...pinned, ...unpinned];
}

function reorderKeepsPinnedPartition(current: NotionTab[], order: string[]): boolean {
  const pinnedCount = current.filter((t) => t.pinned === true).length;
  const pinnedSet = new Set(current.filter((t) => t.pinned === true).map((t) => t.id));
  const unpinnedSet = new Set(current.filter((t) => t.pinned !== true).map((t) => t.id));
  const prefix = order.slice(0, pinnedCount);
  const suffix = order.slice(pinnedCount);
  return prefix.every((id) => pinnedSet.has(id)) && suffix.every((id) => unpinnedSet.has(id));
}

async function readTabs(userId: string): Promise<TabsData> {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = getTabsPath(userId);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    const tabs: NotionTab[] = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const rawTrash: NotionTab[] = Array.isArray(parsed.trash) ? parsed.trash : [];
    const { kept, expired } = purgeExpiredTrash(rawTrash);
    for (const tab of expired) { await deleteTabFiles(tab.id); }
    if (tabs.length) {
      const normalizedTabs = normalizeTabsOrder(tabs);
      const needsPersist = normalizedTabs.some((t, i) => t.id !== tabs[i]?.id);
      const result: TabsData = {
        activeTabId: parsed.activeTabId || normalizedTabs[0].id,
        tabs: normalizedTabs,
        trash: kept,
      };
      if (expired.length || needsPersist) await writeTabs(result, userId);
      return result;
    }
  } catch (err: unknown) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }

  const now = new Date().toISOString();
  const tabId = `${defaultTabId}_${safeId(userId) || "anon"}`;
  const initialData: TabsData = {
    activeTabId: tabId,
    tabs: [{ id: tabId, title: "Actividades Planificadas", createdAt: now, updatedAt: now }],
    trash: [],
  };
  // Only migrate legacy data for the very first default user
  if (!safeId(userId)) {
    await ensureLegacyCopies(tabId);
  } else {
    await createEmptyTabFiles(tabId);
  }
  await writeTabs(initialData, userId);
  return initialData;
}

async function writeTabs(data: TabsData, userId: string) {
  await fs.mkdir(dataDir, { recursive: true });
  const normalized: TabsData = {
    activeTabId: data.activeTabId,
    tabs: normalizeTabsOrder(dedupeTabs(data.tabs)),
    trash: dedupeTabs(data.trash),
  };
  await fs.writeFile(getTabsPath(userId), JSON.stringify(normalized, null, 2), "utf-8");
}

const respondError = (err: unknown) => {
  console.error("/api/notion-tabs error", err);
  const message = err instanceof Error ? err.message : "Error inesperado";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET(request: NextRequest) {
  try {
    const requestedUserId = getUserId(request);
    const authId = getAuthUserId(request);
    const authRole = getAuthUserRole(request);
    // Users can only read their own tabs; admin/dev can read anyone's
    if (requestedUserId && authId && requestedUserId !== authId && authRole !== "admin" && authRole !== "dev") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const userId = requestedUserId || authId || "";
    return NextResponse.json(await readTabs(userId));
  } catch (err) {
    return respondError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestedUserId = getUserId(request);
    const authId = getAuthUserId(request);
    const authRole = getAuthUserRole(request);
    // Only the owner or a dev can write to tabs
    if (requestedUserId && authId && requestedUserId !== authId && authRole !== "dev") {
      return NextResponse.json({ error: "Sin permisos para modificar" }, { status: 403 });
    }
    const userId = requestedUserId || authId || "";
    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // Restore from trash
    if (action === "restore") {
      const current = await readTabs(userId);
      const tabId = String(body?.id || "");
      const trashItem = current.trash.find((t) => t.id === tabId);
      if (!trashItem) return NextResponse.json({ error: "No encontrado en papelera" }, { status: 404 });
      const { trashedAt, ...rest } = trashItem;
      void trashedAt;
      const restored: NotionTab = { ...rest, updatedAt: new Date().toISOString() };
      const existingIds = new Set(current.tabs.map((t) => t.id));
      const nextTabs = existingIds.has(restored.id)
        ? current.tabs
        : normalizeTabsOrder([...current.tabs, restored]);
      const next: TabsData = {
        activeTabId: restored.id,
        tabs: nextTabs,
        trash: current.trash.filter((t) => t.id !== tabId),
      };
      await writeTabs(next, userId);
      return NextResponse.json(next);
    }

    // Permanent delete from trash
    if (action === "permanentDelete") {
      const current = await readTabs(userId);
      const tabId = String(body?.id || "");
      const next: TabsData = {
        ...current,
        trash: current.trash.filter((t) => t.id !== tabId),
      };
      await deleteTabFiles(tabId);
      await writeTabs(next, userId);
      return NextResponse.json(next);
    }

    // Reorder tabs (full permutation of ids)
    if (action === "reorder") {
      const current = await readTabs(userId);
      const order = body?.tabIds as unknown;
      if (!Array.isArray(order) || !order.every((id: unknown) => typeof id === "string")) {
        return NextResponse.json({ error: "tabIds inválido" }, { status: 400 });
      }
      const validIds = new Set(current.tabs.map((t) => t.id));
      if (order.length !== validIds.size || !order.every((id: string) => validIds.has(id))) {
        return NextResponse.json({ error: "orden inválido" }, { status: 400 });
      }
      if (!reorderKeepsPinnedPartition(current.tabs, order)) {
        return NextResponse.json({ error: "Las pestañas fijadas deben ir antes que el resto" }, { status: 400 });
      }
      const tabMap = new Map(current.tabs.map((t) => [t.id, t]));
      const reordered = order.map((id: string) => tabMap.get(id)!);
      const next: TabsData = { ...current, tabs: reordered };
      await writeTabs(next, userId);
      return NextResponse.json(next);
    }

    // Duplicate tab → nueva tabla personal (sin metadatos de compartido)
    if (action === "duplicate") {
      const current = await readTabs(userId);
      const sourceTabId = String(body?.sourceTabId || "");
      const sourceTab = current.tabs.find((t) => t.id === sourceTabId);
      if (!sourceTab) {
        return NextResponse.json({ error: "Tab no encontrada" }, { status: 404 });
      }
      const newId = generateId();
      const cols = await readTabJsonFile("columns", sourceTabId);
      const taskList = await readTabJsonFile("tasks", sourceTabId);
      await writeTabJsonFile("columns", newId, cols);
      await writeTabJsonFile("tasks", newId, taskList);
      const now = new Date().toISOString();
      const baseTitle = sourceTab.title.trim() || "Sin título";
      const newTab: NotionTab = {
        id: newId,
        title: `${baseTitle} (copia)`.slice(0, 200),
        createdAt: now,
        updatedAt: now,
      };
      const srcIdx = current.tabs.findIndex((t) => t.id === sourceTabId);
      const nextTabs = normalizeTabsOrder(
        srcIdx >= 0
          ? [...current.tabs.slice(0, srcIdx + 1), newTab, ...current.tabs.slice(srcIdx + 1)]
          : [...current.tabs, newTab],
      );
      const next: TabsData = { ...current, tabs: nextTabs, activeTabId: newId };
      await writeTabs(next, userId);
      return NextResponse.json(next);
    }

    // Fijar / desfijar (las fijadas quedan primero)
    if (action === "setPinned") {
      const current = await readTabs(userId);
      const id = String(body?.id || "");
      const pinned = Boolean(body?.pinned);
      const tab = current.tabs.find((t) => t.id === id);
      if (!tab) return NextResponse.json({ error: "Tab no encontrada" }, { status: 404 });
      const now = new Date().toISOString();
      const tabs = normalizeTabsOrder(
        current.tabs.map((t) => (t.id === id ? { ...t, pinned, updatedAt: now } : t)),
      );
      const next: TabsData = { ...current, tabs };
      await writeTabs(next, userId);
      return NextResponse.json(next);
    }

    // Create new tab
    const current = await readTabs(userId);
    const now = new Date().toISOString();
    const id = generateId();
    const tab: NotionTab = {
      id,
      title: String(body?.title || `Nueva tabla ${current.tabs.length + 1}`).trim(),
      createdAt: now,
      updatedAt: now,
    };
    await createEmptyTabFiles(id);
    const next: TabsData = { activeTabId: id, tabs: [...current.tabs, tab], trash: current.trash };
    await writeTabs(next, userId);
    return NextResponse.json(next);
  } catch (err) {
    return respondError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const requestedUserId = getUserId(request);
    const authId = getAuthUserId(request);
    const authRole = getAuthUserRole(request);
    if (requestedUserId && authId && requestedUserId !== authId && authRole !== "dev") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const userId = requestedUserId || authId || "";
    const body = await request.json();
    if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    const current = await readTabs(userId);
    const title = String(body.title || "").trim() || "Sin título";
    const now = new Date().toISOString();
    const tabs = current.tabs.map((tab) => tab.id === body.id ? { ...tab, title, updatedAt: now } : tab);
    const next: TabsData = { activeTabId: body.activeTabId || current.activeTabId, tabs, trash: current.trash };
    await writeTabs(next, userId);
    return NextResponse.json(next);
  } catch (err) {
    return respondError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const requestedUserId = getUserId(request);
    const authId = getAuthUserId(request);
    const authRole = getAuthUserRole(request);
    if (requestedUserId && authId && requestedUserId !== authId && authRole !== "dev") {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }
    const userId = requestedUserId || authId || "";
    const body = await request.json();
    if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    const current = await readTabs(userId);
    if (current.tabs.length <= 1) {
      return NextResponse.json({ error: "Debe existir al menos una pestaña" }, { status: 400 });
    }
    const tabToTrash = current.tabs.find((t) => t.id === body.id);
    const tabs = current.tabs.filter((tab) => tab.id !== body.id);
    const activeTabId = current.activeTabId === body.id ? tabs[0].id : current.activeTabId;
    const trash = tabToTrash
      ? [...current.trash, { ...tabToTrash, trashedAt: new Date().toISOString() }]
      : current.trash;
    const next: TabsData = { activeTabId, tabs, trash };
    await writeTabs(next, userId);
    return NextResponse.json(next);
  } catch (err) {
    return respondError(err);
  }
}
