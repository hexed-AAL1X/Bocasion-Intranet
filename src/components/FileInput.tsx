"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { FiPaperclip } from "react-icons/fi";
import { AttachmentFileRow } from "./AttachmentDisplay";
import type { AttachmentValue } from "@/lib/attachments";
import styles from "./FileInput.module.css";

interface FileInputProps {
  value: AttachmentValue[];
  onChange: (value: AttachmentValue[]) => void;
  onClose: () => void;
}

const readFilesAsAttachments = (files: FileList): Promise<AttachmentValue[]> =>
  Promise.all(
    Array.from(files).map(
      (file) =>
        new Promise<AttachmentValue>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result as string });
          reader.onerror = reject;
          reader.readAsDataURL(file);
        })
    )
  );

export const FileInput: React.FC<FileInputProps> = ({ value, onChange, onClose }) => {
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const [cssVars, setCssVars] = useState<Record<string, string>>({});

  valueRef.current = value;

  useEffect(() => {
    const pageEl = containerRef.current?.closest('[class*="page"]') as HTMLElement | null;
    if (!pageEl) return;
    const id = window.requestAnimationFrame(() => {
      const computed = getComputedStyle(pageEl);
      setCssVars({
        "--card": computed.getPropertyValue("--card").trim(),
        "--text": computed.getPropertyValue("--text").trim(),
        "--text-dim": computed.getPropertyValue("--text-dim").trim(),
        "--border": computed.getPropertyValue("--border").trim(),
        "--primary": computed.getPropertyValue("--primary").trim(),
        "--bg": computed.getPropertyValue("--bg").trim(),
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 200;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        setDropdownPos({ top: rect.top - dropdownHeight - 4, left: rect.left });
      } else {
        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
    }
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      const nextFiles = await readFilesAsAttachments(files);
      onChange([...valueRef.current, ...nextFiles]);
    } catch (error) {
      console.error("Error leyendo adjuntos:", error);
    }
    event.target.value = "";
  };

  const displayValue = value.length ? `${value.length} archivo${value.length > 1 ? "s" : ""}` : "";

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        type="text"
        readOnly
        className={styles.input}
        value={displayValue}
        placeholder="Cargar archivos..."
        autoFocus
      />

      {dropdownPos &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            className={styles.panel}
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, ...cssVars } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className={styles.uploadBtn}>
              <FiPaperclip /> Cargar archivos
              <input
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.ods,.zip,.rar"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </label>

            {value.length > 0 ? (
              <div className={styles.fileList}>
                {value.map((file) => (
                  <AttachmentFileRow
                    key={`${file.id || file.name}-${file.size}-${file.dataUrl?.slice(0, 24) || file.url || ""}`}
                    file={file}
                    onRemove={() => onChange(value.filter((item) => item !== file))}
                  />
                ))}
              </div>
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
};
