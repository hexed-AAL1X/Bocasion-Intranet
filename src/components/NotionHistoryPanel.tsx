"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FiClock, FiUser, FiCheck, FiSave, FiRotateCcw } from "react-icons/fi";
import type { NotionRevision } from "@/hooks/useNotionHistory";
import type { SnackbarTone } from "@/hooks/useSnackbar";
import { formatHistoryRelativeDate, revisionKindLabel } from "@/lib/notionHistory";
import styles from "./NotionHistoryPanel.module.css";

type TabOption = { id: string; title: string };

type Props = {
  open: boolean;
  onClose: () => void;
  activeTabId?: string;
  tabs: TabOption[];
  tabTitles: Record<string, string>;
  revisions: NotionRevision[];
  audit: import("@/hooks/useNotionHistory").NotionAuditEntry[];
  loading: boolean;
  onRefresh: (tabId?: string) => void;
  onCreateManual: (tabId: string) => Promise<void>;
  onApply: (tabId: string, revisionId: string) => Promise<void>;
  onRestoreLatest?: (tabId: string) => Promise<void>;
  onNotify?: (message: string, tone: SnackbarTone) => void;
};

export function NotionHistoryPanel({
  open,
  onClose,
  activeTabId,
  tabs,
  tabTitles,
  revisions,
  audit,
  loading,
  onRefresh,
  onCreateManual,
  onApply,
  onRestoreLatest,
  onNotify,
}: Props) {
  const [view, setView] = useState<"revisions" | "actions">("revisions");
  const [filterTabId, setFilterTabId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState<NotionRevision | null>(null);

  const notify = (message: string, tone: SnackbarTone) => {
    onNotify?.(message, tone);
  };

  useEffect(() => {
    if (open) {
      setFilterTabId(activeTabId || "");
      setSelectedId(null);
      onRefresh(activeTabId);
    }
  }, [open, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && filterTabId) onRefresh(filterTabId);
  }, [filterTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRevisions = useMemo(() => {
    if (!filterTabId) return revisions;
    return revisions.filter((r) => r.tabId === filterTabId);
  }, [revisions, filterTabId]);

  const filteredAudit = useMemo(() => {
    if (!filterTabId) return audit;
    return audit.filter((a) => a.tabId === filterTabId);
  }, [audit, filterTabId]);

  const selectedRevision = filteredRevisions.find((r) => r.id === selectedId) ?? null;
  const currentTabTitle = filterTabId
    ? tabTitles[filterTabId] || tabs.find((t) => t.id === filterTabId)?.title || "Tabla"
    : "Todas mis tablas";

  const handleApply = async () => {
    if (!selectedRevision || !filterTabId) return;
    if (selectedRevision.rowCount === 0) {
      notify("Esta revisión está vacía. No se puede aplicar.", "warning");
      return;
    }
    setApplyConfirm(selectedRevision);
  };

  const confirmApply = async () => {
    if (!applyConfirm || !filterTabId) return;
    setApplying(true);
    try {
      await onApply(filterTabId, applyConfirm.id);
      setSelectedId(null);
      setApplyConfirm(null);
      notify(`Revisión #${applyConfirm.revisionNum} restaurada (${applyConfirm.rowCount} filas).`, "success");
    } catch {
      notify("No se pudo aplicar la revisión.", "error");
    } finally {
      setApplying(false);
    }
  };

  const handleRestoreLatest = async () => {
    if (!filterTabId || !onRestoreLatest) return;
    setRestoring(true);
    try {
      await onRestoreLatest(filterTabId);
    } finally {
      setRestoring(false);
    }
  };

  const handleCreateManual = async () => {
    if (!filterTabId) return;
    setCreating(true);
    try {
      await onCreateManual(filterTabId);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.panel} onClick={(e) => e.stopPropagation()} aria-label="Historial">
        <header className={styles.header}>
          <FiClock aria-hidden />
          <h2>Historial</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className={styles.tabFilter}>
          <label htmlFor="history-tab-select">Tabla</label>
          <select
            id="history-tab-select"
            value={filterTabId}
            onChange={(e) => {
              setFilterTabId(e.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">Todas mis tablas</option>
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={view === "actions" ? styles.tabActive : styles.tab}
            onClick={() => setView("actions")}
          >
            Acciones
          </button>
          <button
            type="button"
            className={view === "revisions" ? styles.tabActive : styles.tab}
            onClick={() => setView("revisions")}
          >
            Revisiones
          </button>
        </div>

        {view === "revisions" && (
          <div className={styles.actionsBar}>
            <button
              type="button"
              className={styles.discardBtn}
              disabled={!selectedId}
              onClick={() => setSelectedId(null)}
            >
              Descartar
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              disabled={!selectedId || applying || !filterTabId}
              onClick={() => void handleApply()}
            >
              {applying ? "Aplicando…" : "Aplicar"}
            </button>
          </div>
        )}

        {view === "revisions" && filterTabId && onRestoreLatest && (
          <button
            type="button"
            className={styles.saveRevisionBtn}
            disabled={restoring}
            onClick={() => void handleRestoreLatest()}
          >
            <FiRotateCcw aria-hidden /> {restoring ? "Recuperando…" : "Recuperar última revisión con datos"}
          </button>
        )}

        {view === "revisions" && filterTabId && (
          <button
            type="button"
            className={styles.saveRevisionBtn}
            disabled={creating}
            onClick={() => void handleCreateManual()}
          >
            <FiSave aria-hidden /> {creating ? "Guardando…" : "Guardar revisión ahora"}
          </button>
        )}

        <p className={styles.contextLine}>{currentTabTitle}</p>

        <div className={styles.list}>
          {loading ? (
            <p className={styles.empty}>Cargando…</p>
          ) : view === "revisions" ? (
            filteredRevisions.length === 0 ? (
              <p className={styles.empty}>No hay revisiones guardadas todavía.</p>
            ) : (
              filteredRevisions.map((rev, idx) => {
                const isSelected = selectedId === rev.id;
                const isCurrent = idx === 0 && filterTabId === rev.tabId;
                return (
                  <button
                    key={rev.id}
                    type="button"
                    className={`${styles.revisionCard} ${isSelected ? styles.revisionSelected : ""}`}
                    onClick={() => setSelectedId(rev.id)}
                  >
                    <div className={styles.revisionAvatar}>
                      <FiUser aria-hidden />
                    </div>
                    <div className={styles.revisionBody}>
                      <span className={styles.revisionTime}>{formatHistoryRelativeDate(rev.createdAt)}</span>
                      <span className={styles.revisionLabel}>
                        {isCurrent ? "Versión actual · " : ""}
                        {rev.label || revisionKindLabel(rev.kind)}
                      </span>
                      <span className={styles.revisionMeta}>
                        Por {rev.userName || "Usuario"} · {rev.rowCount} filas · #{rev.revisionNum}
                        {!filterTabId && tabTitles[rev.tabId] ? ` · ${tabTitles[rev.tabId]}` : ""}
                      </span>
                    </div>
                    {isSelected ? <FiCheck className={styles.revisionCheck} aria-hidden /> : null}
                  </button>
                );
              })
            )
          ) : filteredAudit.length === 0 ? (
            <p className={styles.empty}>Sin acciones registradas.</p>
          ) : (
            filteredAudit.map((entry) => (
              <div key={entry.id} className={styles.auditCard}>
                <div className={styles.revisionAvatar}>
                  <FiUser aria-hidden />
                </div>
                <div className={styles.revisionBody}>
                  <span className={styles.revisionTime}>{formatHistoryRelativeDate(entry.createdAt)}</span>
                  <span className={styles.revisionLabel}>{entry.summary}</span>
                  <span className={styles.revisionMeta}>
                    {entry.userName || "Usuario"}
                    {!filterTabId && tabTitles[entry.tabId] ? ` · ${tabTitles[entry.tabId]}` : ""}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {applyConfirm ? (
        <div className={styles.confirmOverlay} onClick={() => !applying && setApplyConfirm(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Restaurar revisión</h3>
            <p>
              ¿Restaurar la revisión <strong>#{applyConfirm.revisionNum}</strong> con{" "}
              <strong>{applyConfirm.rowCount} filas</strong>? Los datos actuales de la tabla se reemplazarán.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                disabled={applying}
                onClick={() => setApplyConfirm(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={styles.confirmApply}
                disabled={applying}
                onClick={() => void confirmApply()}
              >
                {applying ? "Aplicando…" : "Restaurar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
