"use client";

import { useEffect, useState } from "react";
import { FiHelpCircle } from "react-icons/fi";
import styles from "./GlobalShortcuts.module.css";

const ROWS: { keys: string; desc: string }[] = [
  { keys: "Esc", desc: "Cierra el calendario o diálogos abiertos cuando el foco no está en un campo de texto." },
  { keys: "?", desc: "Abre esta ayuda de atajos (pulsa la tecla que lleva el signo de interrogación en tu teclado)." },
  { keys: "Tab / Shift+Tab", desc: "Navega entre controles enlazables en formularios y menús." },
];

export function GlobalShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={() => setOpen(false)}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className={styles.head}>
          <FiHelpCircle aria-hidden />
          <h2 id="shortcuts-title">Atajos útiles</h2>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar ayuda">
            ×
          </button>
        </div>
        <p className={styles.lead}>Funcionan en la mayoría de pantallas cuando no estás escribiendo en un campo.</p>
        <table className={styles.table}>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.keys}>
                <td className={styles.kbdCell}>
                  <kbd className={styles.kbd}>{row.keys}</kbd>
                </td>
                <td>{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footer}>Más detalle por sección en Documentación → Manual.</p>
      </div>
    </div>
  );
}
