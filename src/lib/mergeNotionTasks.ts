export type NotionTaskLike = {
  id?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

function parseTs(value: unknown): number {
  if (!value || typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

function looksLikeAttachments(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      ("dataUrl" in item || ("name" in item && "type" in item)),
  );
}

function attachmentScore(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const dataUrl = (item as { dataUrl?: unknown }).dataUrl;
    if (typeof dataUrl === "string" && dataUrl.length > 0) {
      return sum + dataUrl.length;
    }
    const url = (item as { url?: unknown }).url;
    if (typeof url === "string" && url.length > 0) {
      return sum + 1024;
    }
    const hasData = (item as { hasData?: unknown }).hasData;
    if (hasData) return sum + 1;
    const name = (item as { name?: unknown }).name;
    return sum + (typeof name === "string" && name ? 1 : 0);
  }, 0);
}

function mergeAttachmentField(
  localValue: unknown,
  serverValue: unknown,
  localNewer: boolean,
  localHasKey: boolean,
): unknown {
  const localArr = Array.isArray(localValue) ? localValue : [];
  const serverArr = Array.isArray(serverValue) ? serverValue : [];

  if (localNewer && localHasKey && localArr.length === 0) {
    return localArr;
  }

  const localScore = attachmentScore(localArr);
  const serverScore = attachmentScore(serverArr);
  if (localScore > serverScore) return localArr;
  if (serverScore > localScore) return serverArr;
  if (localArr.length > serverArr.length) return localArr;
  if (serverArr.length > localArr.length) return serverArr;
  if (localNewer && localArr.length > 0) return localArr;
  return serverArr.length > 0 ? serverArr : localArr;
}

function mergeGenericArrayField(
  localValue: unknown,
  serverValue: unknown,
  localNewer: boolean,
  localHasKey: boolean,
): unknown {
  if (localNewer && localHasKey) return localValue;
  return serverValue !== undefined ? serverValue : localValue;
}

export function mergeNotionTask(local: NotionTaskLike, server: NotionTaskLike): NotionTaskLike {
  const localTs = parseTs(local.updatedAt);
  const serverTs = parseTs(server.updatedAt);
  const localNewer = localTs >= serverTs;
  const base = localNewer ? { ...server, ...local } : { ...local, ...server };

  // Solo adjuntos/listas usan merge "rico"; escalares respetan el timestamp más reciente
  // (incluye string vacío al borrar todo el contenido de una celda).
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  for (const key of keys) {
    if (key === "id" || key === "updatedAt") continue;
    const localHasKey = Object.prototype.hasOwnProperty.call(local, key);
    const localValue = local[key];
    const serverValue = server[key];
    if (!Array.isArray(localValue) && !Array.isArray(serverValue)) continue;

    const isAttachmentField =
      looksLikeAttachments(localValue) ||
      looksLikeAttachments(serverValue);
    base[key] = isAttachmentField
      ? mergeAttachmentField(localValue, serverValue, localNewer, localHasKey)
      : mergeGenericArrayField(localValue, serverValue, localNewer, localHasKey);
  }

  if (local.id) base.id = local.id;
  else if (server.id) base.id = server.id;

  const mergedTs = Math.max(localTs, serverTs);
  if (mergedTs > 0) base.updatedAt = new Date(mergedTs).toISOString();

  return base;
}

/** Servidor tiene menos filas o filas que ya no existen → snapshot autoritativo (restore/borrado). */
export function shouldReplaceTasksFromServer(local: NotionTaskLike[], server: NotionTaskLike[]): boolean {
  const serverIds = new Set(server.filter((t) => t.id).map((t) => String(t.id)));
  for (const task of local) {
    if (task.id && !serverIds.has(String(task.id))) return true;
  }
  return server.length < local.length;
}

export function syncNotionTasksFromServer(local: NotionTaskLike[], server: NotionTaskLike[]): NotionTaskLike[] {
  if (shouldReplaceTasksFromServer(local, server)) return server;
  const serverIds = new Set(server.filter((t) => t.id).map((t) => String(t.id)));
  const merged = mergeNotionTasks(local, server);
  return merged.filter((task) => !task.id || serverIds.has(String(task.id)));
}

export function mergeNotionTasks(local: NotionTaskLike[], server: NotionTaskLike[]): NotionTaskLike[] {
  const localById = new Map(local.filter((t) => t.id).map((t) => [String(t.id), t]));
  const serverById = new Map(server.filter((t) => t.id).map((t) => [String(t.id), t]));
  const order: string[] = [];

  for (const task of local) {
    if (task.id) order.push(String(task.id));
  }
  for (const task of server) {
    if (task.id && !order.includes(String(task.id))) order.push(String(task.id));
  }

  const merged: NotionTaskLike[] = [];
  for (const id of order) {
    const localTask = localById.get(id);
    const serverTask = serverById.get(id);
    if (localTask && serverTask) merged.push(mergeNotionTask(localTask, serverTask));
    else merged.push((localTask || serverTask)!);
  }

  return merged;
}
