import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type NotionShare = {
  id: string;
  tab_id: string;
  tab_title: string;
  owner_id: string;
  shared_with_id: string;
  status: "pending" | "accepted" | "declined";
  owner_name?: string;
  shared_with_name?: string;
  created_at: string;
};

// In-memory for dev
const shares: NotionShare[] = [];
const dataDir = DATA_DIR;

const getTabsPath = (userId: string) => path.join(dataDir, `notion-tabs.${userId}.json`);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const tabId  = searchParams.get("tabId")  ?? "";

  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  const received = searchParams.get("received") === "1";

  let result: NotionShare[];
  if (tabId) {
    result = shares.filter(s => s.tab_id === tabId && s.owner_id === userId);
  } else if (received) {
    result = shares.filter(s => s.shared_with_id === userId && s.status === "accepted");
  } else {
    result = shares.filter(s => s.owner_id === userId || s.shared_with_id === userId);
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { tabId, tabTitle, ownerId, sharedWithId, ownerDisplayName } = body;

  if (!tabId || !ownerId || !sharedWithId) {
    return NextResponse.json({ error: "tabId, ownerId y sharedWithId requeridos" }, { status: 400 });
  }

  if (ownerId === sharedWithId) {
    return NextResponse.json({ error: "No puedes compartir contigo mismo" }, { status: 400 });
  }

  const existing = shares.find(
    s => s.tab_id === tabId && s.owner_id === ownerId && s.shared_with_id === sharedWithId && s.status !== "declined"
  );
  if (existing) {
    return NextResponse.json({ error: "Ya existe un share activo" }, { status: 409 });
  }

  const shareId = `share_${randomUUID()}`;
  const now = new Date().toISOString();

  const share: NotionShare = {
    id: shareId,
    tab_id: tabId,
    tab_title: tabTitle ?? "Sin título",
    owner_id: ownerId,
    shared_with_id: sharedWithId,
    status: "pending",
    owner_name: ownerDisplayName,
    created_at: now,
  };
  shares.push(share);

  // Inject invitation message into messages store (via fetch to same server)
  const msgContent = `Te he compartido el Notion "${tabTitle ?? "Sin título"}". Puedes aceptar la invitación para verlo en tu espacio.`;
  try {
    await fetch(new URL("/api/messages", req.url).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: ownerId, toId: sharedWithId, content: msgContent, msgType: "notion_invite", refId: shareId }),
    });
  } catch {
    // non-fatal in dev
  }

  return NextResponse.json({ shareId, status: "pending" });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { shareId, userId, action } = body;

  if (!shareId || !userId || !["accept", "decline", "reopen"].includes(action)) {
    return NextResponse.json({ error: "shareId, userId y action requeridos" }, { status: 400 });
  }

  const share = shares.find(s => s.id === shareId && s.shared_with_id === userId);
  if (!share) return NextResponse.json({ error: "Share no encontrado" }, { status: 404 });

  const effectiveAction = action === "reopen" ? "accept" : action;
  if (action !== "reopen") {
    share.status = effectiveAction === "accept" ? "accepted" : "declined";
  }

  if (effectiveAction === "accept") {
    const now = new Date().toISOString();
    const tabsPath = getTabsPath(userId);
    try {
      let data: { activeTabId: string; tabs: object[]; trash: object[] };
      try {
        const raw = await fs.readFile(tabsPath, "utf-8");
        data = JSON.parse(raw);
      } catch {
        data = { activeTabId: `notion_default_${userId}`, tabs: [{ id: `notion_default_${userId}`, title: "Nueva tabla", createdAt: now, updatedAt: now }], trash: [] };
      }

      const alreadyAdded = data.tabs.some((t: object) => (t as { id: string }).id === share.tab_id);
      if (!alreadyAdded) {
        data.tabs.push({
          id: share.tab_id,
          title: share.tab_title,
          sharedFrom: share.owner_name ?? share.owner_id,
          isShared: true,
          createdAt: now,
          updatedAt: now,
        });
        await fs.writeFile(tabsPath, JSON.stringify(data, null, 2), "utf-8");
      }
    } catch (e) {
      console.error("Error actualizando tabs al aceptar share:", e);
    }
  }

  return NextResponse.json({ ok: true, status: action === "reopen" ? "accepted" : share.status });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { tabId, ownerId } = body;

  if (!tabId || !ownerId) {
    return NextResponse.json({ error: "tabId y ownerId requeridos" }, { status: 400 });
  }

  // Find all shares for this tab by this owner
  const toRemove = shares.filter(s => s.tab_id === tabId && s.owner_id === ownerId);
  if (toRemove.length === 0) {
    return NextResponse.json({ error: "No hay shares activos para esta pestaña" }, { status: 404 });
  }

  // Remove shared tab from recipients' tabs files
  for (const share of toRemove) {
    try {
      const recipientTabsPath = getTabsPath(share.shared_with_id);
      const raw = await fs.readFile(recipientTabsPath, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.tabs)) {
        data.tabs = data.tabs.filter((t: { id?: string }) => t.id !== tabId);
        if (data.activeTabId === tabId) {
          data.activeTabId = data.tabs[0]?.id ?? "";
        }
        await fs.writeFile(recipientTabsPath, JSON.stringify(data, null, 2), "utf-8");
      }
    } catch {
      // recipient file might not exist
    }
  }

  // Remove from in-memory shares
  for (let i = shares.length - 1; i >= 0; i--) {
    if (shares[i].tab_id === tabId && shares[i].owner_id === ownerId) {
      shares.splice(i, 1);
    }
  }

  return NextResponse.json({ ok: true, removed: toRemove.length });
}
