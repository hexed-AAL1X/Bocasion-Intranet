import { NextRequest, NextResponse } from "next/server";
import { loadAttachmentBytes, loadAttachmentMeta, persistAttachmentItem } from "@/lib/notionAttachmentsServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const safe = (value: string | null) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");

export async function POST(request: NextRequest) {
  const tabId = safe(request.nextUrl.searchParams.get("tabId"));
  if (!tabId) {
    return NextResponse.json({ error: "tabId requerido" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const file = (body?.file ?? body) as Record<string, unknown>;
    const saved = await persistAttachmentItem(tabId, file);
    return NextResponse.json({ ok: true, attachment: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error subiendo adjunto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const tabId = safe(request.nextUrl.searchParams.get("tabId"));
  const id = safe(request.nextUrl.searchParams.get("id"));
  if (!tabId || !id) {
    return NextResponse.json({ error: "tabId e id requeridos" }, { status: 400 });
  }

  const meta = await loadAttachmentMeta(tabId, id);
  if (!meta) {
    return NextResponse.json({ error: "Adjunto no encontrado" }, { status: 404 });
  }

  const bytes = await loadAttachmentBytes(tabId, id);
  if (!bytes) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.type || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `inline; filename="${(meta.name || "archivo").replace(/"/g, "")}"`,
    },
  });
}
