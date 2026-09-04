"use client";

import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { FiPaperclip, FiTrash2, FiX } from "react-icons/fi";
import {
  type AttachmentValue,
  copyImageAttachment,
  downloadAttachment,
  isImageAttachment,
  resolveAttachmentSrc,
} from "@/lib/attachments";
import styles from "./AttachmentDisplay.module.css";

type CompactAttachmentProps = {
  file: AttachmentValue;
};

function BrokenAttachmentPill({ file }: { file: AttachmentValue }) {
  return (
    <span className={styles.brokenPill} title={`${file.name} — archivo no disponible, vuelve a subirlo`}>
      <FiPaperclip size={11} aria-hidden />
      {file.name}
    </span>
  );
}

function AttachmentImage({
  file,
  className,
  onBroken,
}: {
  file: AttachmentValue;
  className: string;
  onBroken?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = resolveAttachmentSrc(file);

  if (broken || !src) {
    return <BrokenAttachmentPill file={file} />;
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={file.name}
      className={className}
      onError={() => {
        setBroken(true);
        onBroken?.();
      }}
    />
  );
}

function CompactAttachment({ file }: CompactAttachmentProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const isImage = isImageAttachment(file);
  const src = resolveAttachmentSrc(file);

  if (isImage && src && !broken) {
    return (
      <>
        <button
          type="button"
          className={styles.compactImageBtn}
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
              void copyImageAttachment(file);
              return;
            }
            setPreviewOpen(true);
          }}
          onContextMenu={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await copyImageAttachment(file);
          }}
          title={`${file.name} — Clic: ver · Ctrl+clic o clic derecho: copiar`}
        >
          <AttachmentImage file={file} className={styles.compactThumb} onBroken={() => setBroken(true)} />
        </button>
        {previewOpen ? (
          <ImagePreviewOverlay file={file} onClose={() => setPreviewOpen(false)} onCopied={() => undefined} />
        ) : null}
      </>
    );
  }

  if (isImage && broken) {
    return <BrokenAttachmentPill file={file} />;
  }

  return (
    <button
      type="button"
      className={styles.summaryPill}
      onClick={() => downloadAttachment(file)}
      title={`${file.name} — Clic para descargar`}
    >
      <FiPaperclip size={11} aria-hidden />
      {file.name}
    </button>
  );
}

type AttachmentFileRowProps = {
  file: AttachmentValue;
  onRemove?: () => void;
  showRemove?: boolean;
};

export function AttachmentFileRow({ file, onRemove, showRemove = Boolean(onRemove) }: AttachmentFileRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const isImage = isImageAttachment(file);
  const src = resolveAttachmentSrc(file);

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.setTimeout(() => setHint(null), 2200);
  }, []);

  const handlePrimaryClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isImage) {
      if (e.ctrlKey || e.metaKey) {
        void copyImageAttachment(file).then((ok) => flashHint(ok ? "Imagen copiada" : "No se pudo copiar"));
        return;
      }
      setPreviewOpen(true);
      return;
    }
    downloadAttachment(file);
    flashHint("Descargando…");
  };

  const handleContextMenu = async (e: React.MouseEvent) => {
    if (!isImage) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyImageAttachment(file);
    flashHint(ok ? "Imagen copiada" : "No se pudo copiar");
  };

  return (
    <>
      <div className={styles.fileItem}>
        {isImage && src && !broken ? (
          <button
            type="button"
            className={styles.imageBtn}
            onClick={handlePrimaryClick}
            onContextMenu={handleContextMenu}
            title={`${file.name} — Clic: ver · Ctrl+clic o clic derecho: copiar imagen`}
          >
            <AttachmentImage file={file} className={styles.preview} onBroken={() => setBroken(true)} />
          </button>
        ) : isImage && broken ? (
          <BrokenAttachmentPill file={file} />
        ) : (
          <button
            type="button"
            className={styles.filePill}
            onClick={handlePrimaryClick}
            title={`${file.name} — Clic para descargar`}
          >
            <FiPaperclip aria-hidden />
            <span className={styles.fileName}>{file.name}</span>
          </button>
        )}
        {showRemove && onRemove ? (
          <button type="button" className={styles.removeBtn} onClick={() => onRemove()} aria-label={`Quitar ${file.name}`}>
            <FiTrash2 />
          </button>
        ) : null}
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {previewOpen && isImage ? (
        <ImagePreviewOverlay file={file} onClose={() => setPreviewOpen(false)} onCopied={() => flashHint("Imagen copiada")} />
      ) : null}
    </>
  );
}

function ImagePreviewOverlay({
  file,
  onClose,
  onCopied,
}: {
  file: AttachmentValue;
  onClose: () => void;
  onCopied: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = async () => {
    const ok = await copyImageAttachment(file);
    if (ok) onCopied();
  };

  const [broken, setBroken] = useState(false);
  const src = resolveAttachmentSrc(file);

  return ReactDOM.createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.overlayCard} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={file.name}>
        <div className={styles.overlayHeader}>
          <span className={styles.overlayTitle}>{file.name}</span>
          <div className={styles.overlayActions}>
            <button type="button" className={styles.overlayActionBtn} onClick={() => void handleCopy()}>
              Copiar imagen
            </button>
            <button type="button" className={styles.overlayActionBtn} onClick={() => downloadAttachment(file)}>
              Descargar
            </button>
            <button type="button" className={styles.overlayClose} onClick={onClose} aria-label="Cerrar">
              <FiX />
            </button>
          </div>
        </div>
        {broken || !src ? (
          <BrokenAttachmentPill file={file} />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={src}
            alt={file.name}
            className={styles.overlayImage}
            onError={() => setBroken(true)}
            onContextMenu={(e) => {
              e.preventDefault();
              void handleCopy();
            }}
          />
        )}
        <p className={styles.overlayHint}>Clic derecho sobre la imagen también copia al portapapeles.</p>
      </div>
    </div>,
    document.body
  );
}

type AttachmentSummaryProps = {
  attachments: AttachmentValue[];
  maxVisible?: number;
};

/** Vista compacta en celda (solo lectura): pills clicables */
export function AttachmentSummary({ attachments, maxVisible = 2 }: AttachmentSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? attachments : attachments.slice(0, maxVisible);
  const hidden = attachments.length - maxVisible;

  if (!attachments.length) return null;

  return (
    <div className={styles.summary} onClick={(e) => e.stopPropagation()}>
      {visible.map((file) => (
        <CompactAttachment key={`${file.name}-${file.size}`} file={file} />
      ))}
      {!expanded && hidden > 0 ? (
        <button type="button" className={styles.summaryMore} onClick={() => setExpanded(true)}>
          +{hidden}
        </button>
      ) : null}
    </div>
  );
}
