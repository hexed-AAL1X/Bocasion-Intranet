import type { AttachmentValue } from "@/lib/attachments";
import { resolveNotionAttachmentsApi } from "@/utils/api";

export async function uploadNotionAttachment(tabId: string, file: AttachmentValue): Promise<AttachmentValue> {
  if (file.url && !file.dataUrl) return file;
  const endpoint = `${resolveNotionAttachmentsApi()}?tabId=${encodeURIComponent(tabId)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: {
        id: file.id,
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: file.dataUrl,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Error ${res.status} subiendo adjunto`);
  }
  const data = (await res.json()) as { attachment?: AttachmentValue };
  if (!data.attachment?.url) {
    throw new Error("Respuesta inválida al subir adjunto");
  }
  return data.attachment;
}

export async function uploadNotionAttachments(tabId: string, files: AttachmentValue[]): Promise<AttachmentValue[]> {
  const uploaded: AttachmentValue[] = [];
  for (const file of files) {
    if (file.url && !file.dataUrl) {
      uploaded.push(file);
      continue;
    }
    uploaded.push(await uploadNotionAttachment(tabId, file));
  }
  return uploaded;
}
