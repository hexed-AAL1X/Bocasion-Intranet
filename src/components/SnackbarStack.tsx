"use client";

import React, { type ReactNode } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo } from "react-icons/fi";
import type { SnackbarItem, SnackbarTone } from "@/hooks/useSnackbar";
import styles from "./SnackbarStack.module.css";

const icons: Record<SnackbarTone, ReactNode> = {
  success: <FiCheckCircle aria-hidden />,
  error: <FiAlertCircle aria-hidden />,
  warning: <FiInfo aria-hidden />,
};

type Props = {
  items: SnackbarItem[];
};

export function SnackbarStack({ items }: Props) {
  if (!items.length) return null;

  return (
    <div className={styles.stack} aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div
          key={item.id}
          className={`${styles.snackbar} ${styles[`snackbar_${item.tone}`]}`}
          role="status"
        >
          <div className={styles.inner}>
            <span className={styles.icon}>{icons[item.tone]}</span>
            <span className={styles.message}>{item.message}</span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ animationDuration: `${item.duration}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
