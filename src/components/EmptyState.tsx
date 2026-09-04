"use client";

import type { ReactNode } from "react";
import { FiInbox } from "react-icons/fi";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  compact?: boolean;
};

export function EmptyState({ title, description, icon, compact }: EmptyStateProps) {
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`} role="status">
      <div className={styles.icon} aria-hidden>
        {icon ?? <FiInbox size={compact ? 28 : 40} />}
      </div>
      <div className={styles.text}>
        <p className={styles.title}>{title}</p>
        {description ? <p className={styles.desc}>{description}</p> : null}
      </div>
    </div>
  );
}
