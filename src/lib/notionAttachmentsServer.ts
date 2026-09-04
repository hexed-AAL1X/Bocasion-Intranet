import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export type StoredAttachmentMeta = {
  id: string;
  tabId: string;
  type: string;
  size: number;
  name?: string;
};

const ROOT = path.join(DATA_DIR, "notion-attachments");

function tabDir(tabId: string) {
  const safe = tabId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(ROOT, safe);
}

export function attachmentPublicUrl(tabId: string, id: string) {
  return `/api/notion-attachments?tabId=${encodeURIComponent(tabId)}&id=${encodeURIComponent(id)}`;
}

function generateId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseDataUrl(dataUrl: string): { type: string; bytes: Buffer } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  return { type: match[1] || "application/octet-stream", bytes: Buffer.from(match[2], "base64") };
}

function isAttachmentItem(item: unknown): item is Record<string, unknown> {
  return Boolean(item && typeof item === "object" && !Array.isArray(item));
}

function isAttachmentField(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((item) => isAttachmentItem(item) && ("dataUrl" in item || "url" in item || "name" in item));
}

export async function persistAttachmentItem(tabId: string, item: Record<string, unknown>) {
  const name = String(item.name ?? "archivo");
  const type = String(item.type ?? "application/octet-stream");
  const size = Number(item.size ?? 0);
  let id = String(item.id ?? "");
  if (!id) id = generateId();

  if (item.url && !item.dataUrl) {
    return { id, name, type, size: size || 0, url: String(item.url) };
  }

  const dataUrl = typeof item.dataUrl === "string" ? item.dataUrl : "";
  if (!dataUrl) {
    return { id, name, type, size, url: item.url ? String(item.url) : "" };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error(`Adjunto inválido: ${name}`);

  const dir = tabDir(tabId);
  await fs.mkdir(dir, { recursive: true });
  const binPath = path.join(dir, `${id}.bin`);
  const metaPath = path.join(dir, `${id}.json`);
  await fs.writeFile(binPath, parsed.bytes);
  const finalType = type !== "application/octet-stream" ? type : parsed.type;
  const finalSize = size > 0 ? size : parsed.bytes.length;
  const meta: StoredAttachmentMeta = { id, tabId, type: finalType, size: finalSize, name };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  return { id, name, type: finalType, size: finalSize, url: attachmentPublicUrl(tabId, id) };
}

export async function persistTaskAttachments(task: Record<string, unknown>, tabId: string) {
  for (const [key, value] of Object.entries(task)) {
    if (!isAttachmentField(value)) continue;
    const next = [];
    for (const item of value as unknown[]) {
      if (!isAttachmentItem(item)) continue;
      next.push(await persistAttachmentItem(tabId, item));
    }
    task[key] = next;
  }
}

export async function persistAllTaskAttachments(tasks: Record<string, unknown>[], tabId: string) {
  for (const task of tasks) {
    await persistTaskAttachments(task, tabId);
  }
}

export function stripAttachmentItemForTransport(item: Record<string, unknown>) {
  const out: Record<string, unknown> = {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    type: String(item.type ?? "application/octet-stream"),
    size: Number(item.size ?? 0),
  };
  if (item.url) out.url = String(item.url);
  else if (item.dataUrl) out.hasData = true;
  return out;
}

export function stripTaskForTransport(task: Record<string, unknown>) {
  const copy = { ...task };
  for (const [key, value] of Object.entries(copy)) {
    if (!isAttachmentField(value)) continue;
    copy[key] = (value as unknown[]).map((item) =>
      isAttachmentItem(item) ? stripAttachmentItemForTransport(item) : item,
    );
  }
  return copy;
}

export function stripTasksForTransport(tasks: Record<string, unknown>[]) {
  return tasks.map((task) => stripTaskForTransport(task));
}

export async function loadAttachmentMeta(tabId: string, id: string): Promise<StoredAttachmentMeta | null> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const metaPath = path.join(tabDir(tabId), `${safeId}.json`);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as StoredAttachmentMeta;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadAttachmentBytes(tabId: string, id: string): Promise<Buffer | null> {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const binPath = path.join(tabDir(tabId), `${safeId}.bin`);
  try {
    return await fs.readFile(binPath);
  } catch {
    return null;
  }
}
