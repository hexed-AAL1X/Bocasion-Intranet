export type AttachmentValue = {
  id?: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  url?: string;
  hasData?: boolean;
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

export function resolveAttachmentSrc(file: AttachmentValue): string {
  if (file.dataUrl) return file.dataUrl;
  if (file.url) {
    if (file.url.startsWith("http")) return file.url;
    return `${BASE_PATH}${file.url.startsWith("/") ? file.url : `/${file.url}`}`;
  }
  return "";
}

export function hasAttachmentContent(file: AttachmentValue): boolean {
  return Boolean(file.dataUrl || file.url || file.hasData);
}

export function isImageAttachment(file: AttachmentValue): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

export function downloadAttachment(file: AttachmentValue): void {
  const src = resolveAttachmentSrc(file);
  if (!src) return;
  const link = document.createElement("a");
  link.href = src;
  link.download = file.name || "archivo";
  link.rel = "noopener";
  if (file.url && !file.dataUrl) {
    link.target = "_blank";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function copyImageAttachment(file: AttachmentValue): Promise<boolean> {
  if (!isImageAttachment(file)) return false;
  const src = resolveAttachmentSrc(file);
  if (!src) return false;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      return true;
    }
  } catch {
    /* fallback abajo */
  }
  try {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
