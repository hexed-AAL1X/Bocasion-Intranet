import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

type Message = {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  msg_type: "text" | "notion_invite";
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
};

// In-memory store for dev
const store: Message[] = [];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const withId = searchParams.get("withId") ?? "";
  const unread = searchParams.get("unread") ?? "";

  if (!userId) return NextResponse.json({ error: "userId requerido" }, { status: 400 });

  if (unread === "1") {
    const count = store.filter(m => m.to_id === userId && !m.read_at).length;
    return NextResponse.json({ unread: count });
  }

  if (withId) {
    const msgs = store
      .filter(m => (m.from_id === userId && m.to_id === withId) || (m.from_id === withId && m.to_id === userId))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    // Mark read
    store.forEach(m => {
      if (m.to_id === userId && m.from_id === withId && !m.read_at) {
        m.read_at = new Date().toISOString();
      }
    });
    return NextResponse.json(msgs);
  }

  // Group by conversation partner
  const allMsgs = store.filter(m => m.from_id === userId || m.to_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const convMap = new Map<string, Message & { unread: number }>();
  allMsgs.forEach(m => {
    const otherId = m.from_id === userId ? m.to_id : m.from_id;
    if (!convMap.has(otherId)) {
      const unreadCount = store.filter(x => x.to_id === userId && x.from_id === otherId && !x.read_at).length;
      convMap.set(otherId, { ...m, unread: unreadCount });
    }
  });

  return NextResponse.json(Array.from(convMap.values()));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { fromId, toId, content, msgType = "text", refId = null } = body;

  if (!fromId || !toId || !content?.trim()) {
    return NextResponse.json({ error: "fromId, toId y content requeridos" }, { status: 400 });
  }

  const msg: Message = {
    id: `msg_${randomUUID()}`,
    from_id: fromId,
    to_id: toId,
    content: content.trim(),
    msg_type: msgType,
    ref_id: refId,
    read_at: null,
    created_at: new Date().toISOString(),
  };
  store.push(msg);
  return NextResponse.json(msg);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userId, fromId } = body;

  if (!userId || !fromId) {
    return NextResponse.json({ error: "userId y fromId requeridos" }, { status: 400 });
  }

  store.forEach(m => {
    if (m.to_id === userId && m.from_id === fromId && !m.read_at) {
      m.read_at = new Date().toISOString();
    }
  });

  return NextResponse.json({ ok: true });
}
