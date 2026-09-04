"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { FiSend, FiCheck, FiX, FiMessageSquare, FiPlus } from "react-icons/fi";
import { resolveMessagesApi, resolveSharesApi, resolveUsersApi } from "@/utils/api";
import { useAuthSession } from "./AuthGate";
import { getAvatarUrlForName } from "@/utils/avatars";
import { useFlyoutMount } from "@/hooks/useFlyoutMount";
import flyoutStyles from "../app/page.module.css";
import styles from "./MessagesPanel.module.css";

type Message = {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  msg_type: "text" | "notion_invite";
  ref_id: string | null;
  read_at: string | null;
  created_at: string;
  other_name?: string;
  unread?: number;
};

type SysUser = { id: string; username: string; displayName: string };

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday
      ? d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div className={styles.avatar} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- avatar remoto (DiceBear) */}
      <img
        src={getAvatarUrlForName(name || "usuario")}
        alt={name}
        width={size}
        height={size}
      />
    </div>
  );
}

type Props = {
  show: boolean;
  onClose: () => void;
};

export function MessagesPanel({ show, onClose }: Props) {
  const { mounted, exiting } = useFlyoutMount(show);
  const { user } = useAuthSession();
  const [convs, setConvs] = useState<Message[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [activeConvName, setActiveConvName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sysUsers, setSysUsers] = useState<SysUser[]>([]);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [shareStatuses, setShareStatuses] = useState<
    Record<string, "pending" | "accepted" | "declined" | "processing" | "revoked">
  >({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const myId = user?.id ?? "";

  const loadConversations = useCallback(async () => {
    if (!myId) return;
    try {
      const res = await fetch(`${resolveMessagesApi()}?userId=${encodeURIComponent(myId)}`);
      if (res.ok) setConvs(await res.json());
    } catch { /* noop */ }
  }, [myId]);

  const syncInviteStatuses = useCallback(async (msgs: Message[]) => {
    if (!myId) return;
    const inviteRefs = msgs
      .filter((m) => m.msg_type === "notion_invite" && m.ref_id && m.to_id === myId)
      .map((m) => m.ref_id as string);
    if (inviteRefs.length === 0) return;

    try {
      const res = await fetch(`${resolveSharesApi()}?userId=${encodeURIComponent(myId)}`, { cache: "no-store" });
      if (!res.ok) return;
      const shares = await res.json();
      if (!Array.isArray(shares)) return;

      const byId = new Map<string, string>();
      for (const raw of shares) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as { id?: string; status?: string };
        if (row.id) byId.set(row.id, String(row.status || "pending"));
      }

      const next: Record<string, "pending" | "accepted" | "declined" | "revoked"> = {};
      for (const refId of inviteRefs) {
        const status = byId.get(refId);
        if (status === "accepted" || status === "declined" || status === "pending") {
          next[refId] = status;
        } else {
          next[refId] = "revoked";
        }
      }
      setShareStatuses((prev) => ({ ...prev, ...next }));
    } catch {
      /* noop */
    }
  }, [myId]);

  const loadMessages = useCallback(async (otherId: string) => {
    if (!myId || !otherId) return;
    try {
      const res = await fetch(
        `${resolveMessagesApi()}?userId=${encodeURIComponent(myId)}&withId=${encodeURIComponent(otherId)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const msgs = await res.json();
        setMessages(Array.isArray(msgs) ? msgs : []);
        await syncInviteStatuses(Array.isArray(msgs) ? msgs : []);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch { /* noop */ }
  }, [myId, syncInviteStatuses]);

  useEffect(() => {
    if (!mounted) return;
    const tid = window.setTimeout(() => {
      void loadConversations();
      void fetch(`${resolveUsersApi()}`)
        .then((r) => r.json())
        .then((data: SysUser[]) => setSysUsers(data.filter((u: SysUser) => u.id !== myId)))
        .catch(() => { /* noop */ });
    }, 0);
    return () => window.clearTimeout(tid);
  }, [mounted, loadConversations, myId]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  useEffect(() => {
    if (!activeConv) return;
    const tid = window.setTimeout(() => void loadMessages(activeConv), 0);
    const interval = setInterval(() => void loadMessages(activeConv), 5000);
    return () => {
      window.clearTimeout(tid);
      clearInterval(interval);
    };
  }, [activeConv, loadMessages]);

  const openConv = (otherId: string, otherName: string) => {
    setActiveConv(otherId);
    setActiveConvName(otherName);
    setNewConvOpen(false);
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !myId || !activeConv) return;
    setDraft("");
    try {
      await fetch(resolveMessagesApi(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: myId, toId: activeConv, content }),
      });
      await loadMessages(activeConv);
      await loadConversations();
    } catch { /* noop */ }
  };

  const handleAcceptInvite = async (msg: Message) => {
    if (!msg.ref_id || !myId) return;
    setShareStatuses((s) => ({ ...s, [msg.ref_id!]: "processing" }));
    try {
      const res = await fetch(resolveSharesApi(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId: msg.ref_id, userId: myId, action: "accept" }),
      });
      if (res.ok) {
        setShareStatuses((s) => ({ ...s, [msg.ref_id!]: "accepted" }));
        await loadMessages(activeConv!);
        await loadConversations();
        window.dispatchEvent(new CustomEvent("notion-tabs-updated"));
      }
    } catch { /* noop */ }
  };

  const handleDeclineInvite = async (msg: Message) => {
    if (!msg.ref_id || !myId) return;
    setShareStatuses((s) => ({ ...s, [msg.ref_id!]: "processing" }));
    try {
      await fetch(resolveSharesApi(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId: msg.ref_id, userId: myId, action: "decline" }),
      });
      setShareStatuses((s) => ({ ...s, [msg.ref_id!]: "declined" }));
    } catch { /* noop */ }
  };

  const getOtherName = (conv: Message) => {
    const otherId = conv.from_id === myId ? conv.to_id : conv.from_id;
    const found = sysUsers.find((u) => u.id === otherId);
    return found?.displayName ?? conv.other_name ?? otherId;
  };

  const getOtherId = (conv: Message) => (conv.from_id === myId ? conv.to_id : conv.from_id);

  if (!mounted) return null;

  return (
    <section className={styles.messagesPage} aria-label="Mensajes">
      <div
        className={`${styles.panel} ${exiting ? flyoutStyles.flyoutPs5Exit : flyoutStyles.flyoutPs5Enter}`}
      >
      <div className={styles.topBar}>
        <span className={styles.topBarTitle}>Mensajes</span>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Cerrar mensajes">
          <FiX size={16} />
        </button>
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarHeaderTitle}>Chats</span>
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => setNewConvOpen((v) => !v)}
              aria-expanded={newConvOpen}
            >
              <FiPlus size={12} />
              Nuevo
            </button>
          </div>

          {newConvOpen && (
            <div className={styles.newUserList}>
              {sysUsers.length === 0 ? (
                <p className={styles.emptySidebar}>No hay más usuarios disponibles.</p>
              ) : (
                sysUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={styles.newUserItem}
                    onClick={() => openConv(u.id, u.displayName)}
                  >
                    <Avatar name={u.displayName} size={28} />
                    <span className={styles.newUserName}>{u.displayName}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className={styles.convList}>
            {convs.length === 0 ? (
              <div className={styles.emptySidebar}>
                No hay conversaciones aún.
                <br />
                Pulsa &quot;Nuevo&quot; para iniciar una.
              </div>
            ) : (
              convs.map((conv) => {
                const otherId = getOtherId(conv);
                const name = getOtherName(conv);
                const isUnread = (conv.unread ?? 0) > 0;
                const isActive = activeConv === otherId;
                return (
                  <button
                    key={otherId}
                    type="button"
                    className={`${styles.convItem} ${isActive ? styles.convItemActive : ""}`}
                    onClick={() => openConv(otherId, name)}
                  >
                    <Avatar name={name} size={40} />
                    <div className={styles.convMeta}>
                      <div className={styles.convTop}>
                        <span className={`${styles.convName} ${isUnread ? styles.convNameUnread : ""}`}>{name}</span>
                        <span className={styles.convTime}>{formatTime(conv.created_at)}</span>
                      </div>
                      <div className={styles.convPreview}>
                        {conv.from_id === myId ? "Tú: " : ""}
                        {conv.content}
                      </div>
                    </div>
                    {isUnread ? <span className={styles.unreadBadge}>{conv.unread}</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className={styles.chatArea}>
          {!activeConv ? (
            <div className={styles.chatEmpty}>
              <div className={styles.chatEmptyIcon}>
                <FiMessageSquare />
              </div>
              <div className={styles.chatEmptyTitle}>Bocasión Web</div>
              <p className={styles.chatEmptySub}>
                Selecciona un chat de la lista o inicia una conversación nueva para ver los mensajes aquí.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.chatHeader}>
                <Avatar name={activeConvName} size={36} />
                <div>
                  <div className={styles.chatHeaderName}>{activeConvName}</div>
                  <div className={styles.chatHeaderSub}>Conversación directa</div>
                </div>
              </div>

              <div className={styles.messagesScroll}>
                {messages.length === 0 ? (
                  <div className={styles.messagesEmpty}>No hay mensajes aún. Sé el primero en escribir.</div>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.from_id === myId;
                    const isInvite = msg.msg_type === "notion_invite";
                    const inviteStatus = msg.ref_id ? shareStatuses[msg.ref_id] : null;

                    return (
                      <div
                        key={msg.id}
                        className={`${styles.messageRow} ${isMine ? styles.messageRowMine : styles.messageRowOther}`}
                      >
                        {isInvite && !isMine ? (
                          <div className={styles.inviteCard}>
                            <div className={styles.inviteLabel}>Invitación a Notion</div>
                            <div className={styles.inviteText}>{msg.content}</div>
                            {!inviteStatus || inviteStatus === "pending" ? (
                              <div className={styles.inviteActions}>
                                <button type="button" className={styles.inviteBtnAccept} onClick={() => handleAcceptInvite(msg)}>
                                  <FiCheck size={12} /> Aceptar
                                </button>
                                <button type="button" className={styles.inviteBtnDecline} onClick={() => handleDeclineInvite(msg)}>
                                  <FiX size={12} /> Rechazar
                                </button>
                              </div>
                            ) : inviteStatus === "processing" ? (
                              <div className={styles.inviteStatus}>Procesando...</div>
                            ) : inviteStatus === "accepted" ? (
                              <div className={`${styles.inviteStatus} ${styles.inviteStatusOk}`}>✓ Invitación aceptada</div>
                            ) : inviteStatus === "revoked" ? (
                              <div className={styles.inviteStatus}>Esta invitación ya no está activa</div>
                            ) : (
                              <div className={styles.inviteStatus}>Invitación rechazada</div>
                            )}
                          </div>
                        ) : (
                          <div className={`${styles.bubble} ${isMine ? styles.bubbleMine : styles.bubbleOther}`}>
                            {msg.content}
                          </div>
                        )}
                        <span className={styles.messageTime}>{formatTime(msg.created_at)}</span>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              <div className={styles.chatInputBar}>
                <input
                  ref={inputRef}
                  className={styles.chatInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Escribe un mensaje..."
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  className={`${styles.sendBtn} ${draft.trim() ? styles.sendBtnActive : styles.sendBtnIdle}`}
                  aria-label="Enviar mensaje"
                >
                  <FiSend size={15} />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      </div>
    </section>
  );
}
