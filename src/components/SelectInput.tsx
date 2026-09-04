"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { FiPlus } from "react-icons/fi";
import styles from "./SelectInput.module.css";

interface SelectInputProps {
  type: "Seleccionar" | "Selección múltiple";
  options: string[];
  value: unknown;
  onChange: (value: unknown) => void;
  onClose: () => void;
  onAddOption: (option: string) => void;
}

export const SelectInput: React.FC<SelectInputProps> = ({
  type,
  options,
  value,
  onChange,
  onClose,
  onAddOption,
}) => {
  const selectedSingle = typeof value === "string" ? value : "";
  const selectedMulti: string[] = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
    ? value.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const [draft, setDraft] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [cssVars, setCssVars] = useState<Record<string, string>>({});

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
    const updatePosition = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 280; // approximate panel height
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        // Open above
        setDropdownPos({ top: rect.top - dropdownHeight - 4, left: rect.left });
      } else {
        // Open below
        setDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
    };
    updatePosition();
    // Al hacer scroll en cualquier contenedor (incluida la tabla), cerrar el
    // dropdown para que no quede flotando y superponiéndose al resto.
    // Se ignora el scroll que ocurre dentro del propio panel.
    const handleScroll = (event: Event) => {
      const target = event.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [onClose]);

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

  const handleSelect = (option: string) => {
    if (type === "Seleccionar") {
      onChange(option);
      onClose();
    } else {
      const isActive = selectedMulti.includes(option);
      const next = isActive
        ? selectedMulti.filter((item) => item !== option)
        : [...selectedMulti, option];
      onChange(next.join(", "));
    }
  };

  const handleAddOption = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddOption(trimmed);
    setDraft("");
  };

  const displayValue = type === "Seleccionar"
    ? selectedSingle || ""
    : selectedMulti.join(", ");

  return (
    <div className={styles.container} ref={containerRef}>
      <input
        type="text"
        readOnly
        className={styles.input}
        value={displayValue}
        placeholder={type === "Seleccionar" ? "Seleccionar..." : "Seleccionar opciones..."}
        autoFocus
      />

      {dropdownPos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className={styles.panel}
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, ...cssVars } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className={styles.title}>{type}</div>

          {options.length > 0 && (
            <div className={styles.optionsGrid}>
              {options.map((option) => {
                const isActive = type === "Seleccionar"
                  ? selectedSingle === option
                  : selectedMulti.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    className={`${styles.pill} ${isActive ? styles.pillActive : ""}`}
                    onClick={() => handleSelect(option)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          {options.length === 0 && (
            <div className={styles.empty}>No hay opciones todavía.</div>
          )}

          <div className={styles.createRow}>
            <input
              className={styles.createInput}
              value={draft}
              placeholder="Crear opción..."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddOption();
                }
              }}
            />
            <button
              type="button"
              className={styles.createBtn}
              onClick={handleAddOption}
            >
              <FiPlus />
            </button>
          </div>

          {type === "Selección múltiple" && (
            <div className={styles.helper}>Puedes elegir una o varias opciones.</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};
