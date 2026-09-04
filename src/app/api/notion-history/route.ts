import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export const runtime = "nodejs";

const HISTORY_DIR = path.join(DATA_DIR, "notion-history");
const HISTORY_ATTACHMENTS_DIR = path.join(DATA_DIR, "notion-history-attachments");
const MAX_REVISIONS = 25;
const MAX_AUDIT = 200;
const AUTO_MIN_MS = 10 * 60 * 1000;

type RevisionKind = "auto" | "manual" | "pre_destructive";

type Revision = {
  id: string;
  tabId: string;
  revisionNum: number;
  userId: string;
  userName: string;
  kind: RevisionKind;
  label: string;
  pinned: boolean;
  rowCount: number;
  contentHash: string;
  createdAt: string;
  tasks: unknown[];
  columns: { baseColumns: unknown[]; customColumns: unknown[] };
};

type AuditEntry = {
  id: number;
  tabId: string;
  userId: string;
  userName: string;
  action: string;
  summary: string;
  meta?: Record<string, unknown> | null;
  createdAt: string;
};

type TabHistoryFile = {
  revisions: Revision[];
  audit: AuditEntry[];
  meta?: { lastAutoAt?: string | null };
};

const safeId = (value: string | null) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");

const historyPath = (tabId: string) => path.join(HISTORY_DIR, `${safeId(tabId)}.json`);
const tasksPath = (tabId: string) => path.join(DATA_DIR, `tasks.${safeId(tabId)}.json`);
const columnsPath = (tabId: string) => path.join(DATA_DIR, `columns.${safeId(tabId)}.json`);
const tabsPath = (userId: string) => path.join(DATA_DIR, `notion-tabs.${safeId(userId)}.json`);

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isAttachmentItem(item: unknown): item is Record<string, unknown> {
  return !!item && typeof item === "object" && ("dataUrl" in item || "url" in item || "name" in item);
}

function isAttachmentField(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some(isAttachmentItem);
}

function revisionAttachmentsDir(tabId: string, revisionId: string) {
  return path.join(HISTORY_ATTACHMENTS_DIR, safeId(tabId), safeId(revisionId));
}

async function copyAttachmentFiles(srcDir: string, destDir: string, attachmentId: string) {
  const id = safeId(attachmentId);
  if (!id) return false;
  const bin = path.join(srcDir, `${id}.bin`);
  try {
    await fs.access(bin);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(bin, path.join(destDir, `${id}.bin`));
    const meta = path.join(srcDir, `${id}.json`);
    try {
      await fs.access(meta);
      await fs.copyFile(meta, path.join(destDir, `${id}.json`));
    } catch {
      /* optional meta */
    }
    return true;
  } catch {
    return false;
  }
}

async function backupRevisionAttachments(tabId: string, revisionId: string, tasks: unknown[]) {
  const destDir = revisionAttachmentsDir(tabId, revisionId);
  const liveDir = path.join(DATA_DIR, "notion-attachments", safeId(tabId));
  const seen = new Set<string>();

  for (const task of tasks) {
    if (!task || typeof task !== "object") continue;
    for (const value of Object.values(task as Record<string, unknown>)) {
      if (!isAttachmentField(value)) continue;
      for (const item of value) {
        if (!isAttachmentItem(item)) continue;
        let id = safeId(String(item.id ?? ""));
        if (!id) id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (seen.has(id)) continue;
        seen.add(id);

        if (typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:")) {
          const match = item.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
          if (match) {
            const bytes = Buffer.from(match[2], "base64");
            await fs.mkdir(destDir, { recursive: true });
            await fs.writeFile(path.join(destDir, `${id}.bin`), bytes);
            await fs.writeFile(
              path.join(destDir, `${id}.json`),
              JSON.stringify({ id, type: item.type ?? match[1], size: bytes.length }),
            );
          }
          continue;
        }

        await copyAttachmentFiles(liveDir, destDir, id);
      }
    }
  }
}

async function restoreRevisionAttachments(tabId: string, revisionId: string, tasks: unknown[]) {
  const srcDir = revisionAttachmentsDir(tabId, revisionId);
  const destDir = path.join(DATA_DIR, "notion-attachments", safeId(tabId));
  const restored: unknown[] = [];

  for (const task of tasks) {
    if (!task || typeof task !== "object") {
      restored.push(task);
      continue;
    }
    const copy = { ...(task as Record<string, unknown>) };
    for (const [key, value] of Object.entries(copy)) {
      if (!isAttachmentField(value)) continue;
      const next: unknown[] = [];
      for (const item of value) {
        if (!isAttachmentItem(item)) {
          next.push(item);
          continue;
        }
        const id = safeId(String(item.id ?? ""));
        if (id) {
          await copyAttachmentFiles(srcDir, destDir, id);
          const att = { ...item };
          delete att.dataUrl;
          att.url = `/api/notion-attachments?tabId=${encodeURIComponent(tabId)}&id=${encodeURIComponent(id)}`;
          next.push(att);
        } else {
          next.push(item);
        }
      }
      copy[key] = next;
    }
    restored.push(copy);
  }

  return restored;
}

function stripTasks(tasks: unknown[]): unknown[] {
  return tasks.map((task) => {
    if (!task || typeof task !== "object") return task;
    const copy = { ...(task as Record<string, unknown>) };
    for (const [key, value] of Object.entries(copy)) {
      if (!Array.isArray(value)) continue;
      const looksLikeAttachments = value.some(
        (item) => item && typeof item === "object" && ("dataUrl" in item || "name" in item),
      );
      if (!looksLikeAttachments) continue;
      copy[key] = value.map((item) => {
        if (!item || typeof item !== "object") return item;
        const att = item as Record<string, unknown>;
        const out: Record<string, unknown> = {
          name: att.name ?? "",
          type: att.type ?? "application/octet-stream",
          size: att.size ?? 0,
        };
        const id = safeId(String(att.id ?? ""));
        if (id) out.id = id;
        if (typeof att.url === "string" && att.url) out.url = att.url;
        if (typeof att.dataUrl === "string" && att.dataUrl) out.hasData = true;
        else if (att.hasData) out.hasData = true;
        return out;
      });
    }
    return copy;
  });
}

function contentHash(tasks: unknown[], columns: unknown) {
  const payload = JSON.stringify({ tasks: stripTasks(tasks), columns });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  return String(hash);
}

async function loadLiveTasks(tabId: string): Promise<unknown[]> {
  const data = await readJson<unknown[]>(tasksPath(tabId), []);
  return Array.isArray(data) ? data : [];
}

async function loadLiveColumns(tabId: string) {
  const data = await readJson<{ baseColumns?: unknown[]; customColumns?: unknown[] }>(columnsPath(tabId), {
    baseColumns: [],
    customColumns: [],
  });
  return {
    baseColumns: Array.isArray(data.baseColumns) ? data.baseColumns : [],
    customColumns: Array.isArray(data.customColumns) ? data.customColumns : [],
  };
}

async function saveLiveTasks(tabId: string, tasks: unknown[]) {
  await writeJson(tasksPath(tabId), tasks);
}

async function saveLiveColumns(tabId: string, columns: { baseColumns: unknown[]; customColumns: unknown[] }) {
  await writeJson(columnsPath(tabId), columns);
}

async function readTabHistory(tabId: string): Promise<TabHistoryFile> {
  return readJson<TabHistoryFile>(historyPath(tabId), { revisions: [], audit: [], meta: {} });
}

async function writeTabHistory(tabId: string, data: TabHistoryFile) {
  if (data.revisions.length > MAX_REVISIONS) {
    data.revisions = data.revisions
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_REVISIONS);
  }
  if (data.audit.length > MAX_AUDIT) {
    data.audit = data.audit.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_AUDIT);
  }
  await writeJson(historyPath(tabId), data);
}

async function getAccessibleTabIds(userId: string): Promise<string[]> {
  const tabsData = await readJson<{ tabs?: { id?: string }[] }>(tabsPath(userId), { tabs: [] });
  const ids = (tabsData.tabs ?? []).map((t) => safeId(t.id || "")).filter(Boolean);
  return [...new Set(ids)];
}

async function getTabTitles(userId: string): Promise<Record<string, string>> {
  const tabsData = await readJson<{ tabs?: { id?: string; title?: string }[] }>(tabsPath(userId), { tabs: [] });
  const map: Record<string, string> = {};
  for (const tab of tabsData.tabs ?? []) {
    if (tab.id) map[safeId(tab.id)] = tab.title || "Sin título";
  }
  return map;
}

function toSummary(rev: Revision) {
  const { tasks, columns, ...rest } = rev;
  void tasks;
  void columns;
  return rest;
}

async function createRevision(
  tabId: string,
  userId: string,
  userName: string,
  kind: RevisionKind,
  label: string,
): Promise<Revision | null> {
  const tasks = await loadLiveTasks(tabId);
  const columns = await loadLiveColumns(tabId);
  const stripped = stripTasks(tasks);
  const hash = contentHash(tasks, columns);
  const file = await readTabHistory(tabId);
  if (file.revisions[0]?.contentHash === hash) return null;
  if (kind === "auto" && stripped.length === 0) return null;

  const revision: Revision = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    revisionNum: (file.revisions[0]?.revisionNum ?? 0) + 1,
    userId,
    userName,
    kind,
    label,
    pinned: false,
    rowCount: stripped.length,
    contentHash: hash,
    createdAt: new Date().toISOString(),
    tasks: stripped,
    columns,
  };
  file.revisions.unshift(revision);
  await writeTabHistory(tabId, file);
  await backupRevisionAttachments(tabId, revision.id, tasks);
  return revision;
}

async function logAudit(
  tabId: string,
  userId: string,
  userName: string,
  action: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  const file = await readTabHistory(tabId);
  const entry: AuditEntry = {
    id: (file.audit[0]?.id ?? 0) + 1,
    tabId,
    userId,
    userName,
    action,
    summary,
    meta: meta ?? null,
    createdAt: new Date().toISOString(),
  };
  file.audit.unshift(entry);
  await writeTabHistory(tabId, file);
  return entry;
}

export async function GET(request: NextRequest) {
  const userId = safeId(request.nextUrl.searchParams.get("userId"));
  const tabId = safeId(request.nextUrl.searchParams.get("tabId"));
  const revisionId = safeId(request.nextUrl.searchParams.get("revisionId"));
  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  const accessible = await getAccessibleTabIds(userId);
  if (tabId && !accessible.includes(tabId)) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  if (revisionId && tabId) {
    const file = await readTabHistory(tabId);
    const revision = file.revisions.find((r) => r.id === revisionId);
    if (!revision) return NextResponse.json({ error: "Revisión no encontrada" }, { status: 404 });
    return NextResponse.json(revision);
  }

  const targetTabs = tabId ? [tabId] : accessible;
  const revisions: ReturnType<typeof toSummary>[] = [];
  const audit: AuditEntry[] = [];

  for (const id of targetTabs) {
    const file = await readTabHistory(id);
    revisions.push(...file.revisions.map(toSummary));
    audit.push(...file.audit);
  }

  revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  audit.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({
    tabTitles: await getTabTitles(userId),
    revisions: revisions.slice(0, 50),
    audit: audit.slice(0, 80),
  });
}

export async function POST(request: NextRequest) {
  const userId = safeId(request.nextUrl.searchParams.get("userId"));
  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  const body = await request.json();
  const tabId = safeId(body.tabId);
  const userName = String(body.userName || "");
  const action = String(body.action || "");

  const accessible = await getAccessibleTabIds(userId);
  if (!tabId || !accessible.includes(tabId)) {
    return NextResponse.json({ error: "Sin acceso a esta tabla" }, { status: 403 });
  }

  switch (action) {
    case "create_revision": {
      const label = String(body.label || "Revisión manual");
      const revision = await createRevision(tabId, userId, userName, "manual", label);
      if (revision) await logAudit(tabId, userId, userName, "manual_revision", label, { revisionId: revision.id });
      return NextResponse.json({ ok: true, revision: revision ? toSummary(revision) : null, skipped: !revision });
    }
    case "stable_checkpoint": {
      const file = await readTabHistory(tabId);
      const lastAuto = file.meta?.lastAutoAt ? Date.parse(file.meta.lastAutoAt) : 0;
      if (Date.now() - lastAuto < AUTO_MIN_MS) {
        return NextResponse.json({ ok: true, skipped: true });
      }
      const revision = await createRevision(tabId, userId, userName, "auto", "Revisión automática estable");
      if (revision) {
        file.meta = { ...file.meta, lastAutoAt: new Date().toISOString() };
        await writeTabHistory(tabId, file);
        await logAudit(tabId, userId, userName, "auto_revision", "Revisión automática guardada", {
          revisionId: revision.id,
        });
      }
      return NextResponse.json({ ok: true, revision: revision ? toSummary(revision) : null, skipped: !revision });
    }
    case "pre_bulk_delete": {
      const deleteCount = Number(body.deleteCount || 0);
      const label = `Antes de eliminar ${deleteCount} fila(s)`;
      const revision = await createRevision(tabId, userId, userName, "pre_destructive", label);
      await logAudit(tabId, userId, userName, "pre_bulk_delete", label, {
        beforeCount: body.beforeCount,
        deleteCount,
      });
      return NextResponse.json({ ok: true, revision: revision ? toSummary(revision) : null });
    }
    case "apply_revision": {
      const revisionId = safeId(body.revisionId);
      const file = await readTabHistory(tabId);
      const revision = file.revisions.find((r) => r.id === revisionId);
      if (!revision) return NextResponse.json({ error: "Revisión no encontrada" }, { status: 404 });

      await createRevision(tabId, userId, userName, "manual", `Antes de restaurar #${revision.revisionNum}`);
      const liveTasks = await loadLiveTasks(tabId);
      const liveById = new Map<string, Record<string, unknown>>();
      for (const task of liveTasks) {
        if (task && typeof task === "object" && (task as { id?: string }).id) {
          liveById.set(String((task as { id: string }).id), task as Record<string, unknown>);
        }
      }
      const restored = revision.tasks.map((task) => {
        if (!task || typeof task !== "object") return task;
        const copy = { ...(task as Record<string, unknown>) };
        const live = copy.id ? liveById.get(String(copy.id)) : undefined;
        if (!live) return copy;
        for (const [key, value] of Object.entries(copy)) {
          if (!Array.isArray(value) || !Array.isArray(live[key])) continue;
          const liveByKey = new Map<string, Record<string, unknown>>();
          const liveByAttId = new Map<string, Record<string, unknown>>();
          for (const item of live[key] as unknown[]) {
            if (!item || typeof item !== "object") continue;
            const att = item as Record<string, unknown>;
            liveByKey.set(`${att.name}|${att.size}`, att);
            if (att.id) liveByAttId.set(String(att.id), att);
          }
          copy[key] = value.map((item) => {
            if (!item || typeof item !== "object") return item;
            const att = item as Record<string, unknown>;
            if (att.dataUrl || att.url) return att;
            if (att.id && liveByAttId.has(String(att.id))) {
              return liveByAttId.get(String(att.id));
            }
            const found = liveByKey.get(`${att.name}|${att.size}`);
            return found ?? att;
          });
        }
        return copy;
      });

      const withAttachments = await restoreRevisionAttachments(tabId, revisionId, restored);

      await saveLiveTasks(tabId, withAttachments);
      await saveLiveColumns(tabId, revision.columns);
      await logAudit(tabId, userId, userName, "apply_revision", `Restauró revisión #${revision.revisionNum}`, {
        revisionId,
      });
      return NextResponse.json({ ok: true, tasks: withAttachments, columns: revision.columns });
    }
    default:
      return NextResponse.json({ error: "action inválida" }, { status: 400 });
  }
}
