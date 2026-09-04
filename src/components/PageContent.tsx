"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "../app/page.module.css";
import { useNotionToggle } from "@/contexts/NotionToggleContext";
import { useMessagesToggle } from "@/contexts/MessagesToggleContext";
import { useCalendarToggle } from "@/contexts/CalendarToggleContext";
import { useCalendarEventsContext } from "@/contexts/CalendarEventsContext";
import { consumePendingWorkspacePanel, peekPendingWorkspacePanel } from "@/lib/workspaceNav";
import { MessagesPanel } from "./MessagesPanel";
import { CalendarOverlay } from "./CalendarOverlay";

type PageContentProps = {
  children: ReactNode;
  className?: string;
};

export function PageContent({ children, className }: PageContentProps) {
  const pathname = usePathname() ?? "/";
  const { notionTransition, isNotionRoute, consumeSuppressRouteEnter } = useNotionToggle();
  const { showMessages, setShowMessages } = useMessagesToggle();
  const { showCalendar, setShowCalendar } = useCalendarToggle();
  const { events, addEvent, deleteEvent } = useCalendarEventsContext();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [routeEntering, setRouteEntering] = useState(false);
  const prevPathRef = useRef(pathname);

  const pendingPanel = !isNotionRoute ? peekPendingWorkspacePanel() : null;
  const displayMessages = showMessages || pendingPanel === "messages";
  const displayCalendar = !displayMessages && (showCalendar || pendingPanel === "calendar");
  const openingNotion = notionTransition === "open" && !isNotionRoute;

  useLayoutEffect(() => {
    if (isNotionRoute) return;
    const pending = consumePendingWorkspacePanel();
    if (pending === "calendar") setShowCalendar(true);
    else if (pending === "messages") setShowMessages(true);
  }, [isNotionRoute, pathname, setShowCalendar, setShowMessages]);

  useEffect(() => {
    if (notionTransition !== null) return;
    consumeSuppressRouteEnter();
    setRouteEntering(false);
  }, [notionTransition, consumeSuppressRouteEnter]);

  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;

    if (notionTransition) return;
    if (consumeSuppressRouteEnter()) return;
    if (peekPendingWorkspacePanel()) return;

    setRouteEntering(true);
    const timer = window.setTimeout(() => setRouteEntering(false), 480);
    return () => window.clearTimeout(timer);
  }, [pathname, notionTransition, consumeSuppressRouteEnter]);

  useEffect(() => {
    if (!isNotionRoute) return;
    setShowCalendar(false);
    setShowMessages(false);
  }, [isNotionRoute, setShowCalendar, setShowMessages]);

  let motionClass = "";
  if (isNotionRoute) {
    if (notionTransition === "close") motionClass = styles.notionPs5Exit;
    else if (notionTransition === "open") motionClass = styles.notionPs5Enter;
  } else if (!notionTransition && routeEntering && !displayCalendar && !displayMessages) {
    motionClass = styles.pageContentPs5Enter;
  }

  if (!isNotionRoute && displayMessages) {
    return (
      <div className={`${styles.pageContent} ${className ?? ""}`.trim()}>
        <MessagesPanel show onClose={() => setShowMessages(false)} />
      </div>
    );
  }

  if (!isNotionRoute && displayCalendar) {
    return (
      <div className={`${styles.pageContent} ${className ?? ""}`.trim()}>
        <CalendarOverlay
          show
          onClose={() => setShowCalendar(false)}
          events={events}
          onAdd={addEvent}
          onDelete={deleteEvent}
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
        />
      </div>
    );
  }

  if (openingNotion) {
    return <div className={`${styles.pageContent} ${className ?? ""}`.trim()} />;
  }

  return (
    <div
      className={`${styles.pageContent} ${className ?? ""} ${motionClass}`.trim()}
    >
      {children}
    </div>
  );
}
