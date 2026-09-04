"use client";

import { useState } from "react";
import { FiX } from "react-icons/fi";
import styles from "./AvatarPicker.module.css";
import { AVATAR_CHARACTERS } from "@/utils/avatars";

type Props = {
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function AvatarPicker({ currentId, onSelect, onClose }: Props) {
  const [selected, setSelected] = useState(currentId);
  const females = AVATAR_CHARACTERS.filter((c) => c.gender === "female");
  const males = AVATAR_CHARACTERS.filter((c) => c.gender === "male");

  const renderGroup = (label: string, chars: typeof AVATAR_CHARACTERS) => (
    <>
      <div className={styles.groupLabel}>{label}</div>
      <div className={styles.grid}>
        {chars.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`${styles.option} ${selected === c.id ? styles.optionActive : ""}`}
            onClick={() => setSelected(c.id)}
            aria-label={c.label}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- avatar remoto (DiceBear) */}
            <img src={c.url} alt={c.label} />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Elige tu personaje</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
            <FiX />
          </button>
        </div>
        {renderGroup("Mujeres", females)}
        {renderGroup("Hombres", males)}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={() => {
              onSelect(selected);
              onClose();
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
