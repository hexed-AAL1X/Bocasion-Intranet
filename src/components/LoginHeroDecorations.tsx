"use client";

import { useEffect, useRef } from "react";
import styles from "./AuthGate.module.css";

type LoginDecorProps = {
  variant?: "light" | "dark";
};

type Floater = {
  el: HTMLElement;
  ampX: number;
  ampY: number;
  speed: number;
  phase: number;
  spin?: number;
  pulse?: boolean;
};

/** Decoraciones dinámicas (animación por rAF — no depende solo de CSS). */
export function LoginHeroDecorations({ variant = "dark" }: LoginDecorProps) {
  const rootClass = variant === "light" ? styles.formDecor : styles.heroDecor;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const nodes = root.querySelectorAll<HTMLElement>("[data-float]");
    const floaters: Floater[] = Array.from(nodes).map((el, i) => {
      const kind = el.dataset.float || "drift";
      const base = {
        el,
        ampX: 18 + (i % 5) * 8,
        ampY: 14 + (i % 4) * 10,
        speed: 0.35 + (i % 6) * 0.12,
        phase: i * 1.1,
      };
      if (kind === "spin") return { ...base, ampX: 10, ampY: 10, spin: 0.08 + (i % 3) * 0.04 };
      if (kind === "pulse") return { ...base, ampX: 6, ampY: 8, pulse: true, speed: 0.9 + (i % 4) * 0.2 };
      if (kind === "blob") return { ...base, ampX: 36 + i * 10, ampY: 28 + i * 8, speed: 0.22 + i * 0.05 };
      return base;
    });

    let raf = 0;
    const tick = (t: number) => {
      const time = t / 1000;
      for (const f of floaters) {
        const x = Math.sin(time * f.speed + f.phase) * f.ampX;
        const y = Math.cos(time * f.speed * 0.85 + f.phase) * f.ampY;
        const rot = f.spin ? time * f.spin * 57.3 + f.phase * 20 : Math.sin(time * 0.4 + f.phase) * 8;
        const scale = f.pulse
          ? 0.75 + (Math.sin(time * f.speed * 2 + f.phase) + 1) * 0.2
          : 1 + Math.sin(time * f.speed + f.phase) * 0.06;
        f.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={rootClass} ref={rootRef} aria-hidden>
      <span className={`${styles.blob} ${styles.blobA}`} data-float="blob" />
      <span className={`${styles.blob} ${styles.blobB}`} data-float="blob" />
      <span className={`${styles.blob} ${styles.blobC}`} data-float="blob" />

      <svg className={styles.decorDotGrid} data-float="drift" viewBox="0 0 72 72" fill="currentColor">
        {Array.from({ length: 9 }).map((_, i) => {
          const x = (i % 3) * 28 + 8;
          const y = Math.floor(i / 3) * 28 + 8;
          return <circle key={i} cx={x} cy={y} r="3.5" />;
        })}
      </svg>

      <svg
        className={styles.decorHexLarge}
        data-float="spin"
        viewBox="0 0 200 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      >
        <polygon points="100,8 178,53 178,147 100,192 22,147 22,53" />
        <polygon points="100,32 154,63 154,137 100,168 46,137 46,63" />
      </svg>
      <svg
        className={styles.decorHexSmall}
        data-float="drift"
        viewBox="0 0 120 120"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <polygon points="60,6 108,33 108,87 60,114 12,87 12,33" />
      </svg>

      <div className={styles.decorStripedCircle} data-float="spin" />

      <svg className={`${styles.decorSparkle} ${styles.decorSparkleA}`} data-float="pulse" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" />
      </svg>
      <svg className={`${styles.decorSparkle} ${styles.decorSparkleB}`} data-float="pulse" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" />
      </svg>
      <svg className={`${styles.decorSparkle} ${styles.decorSparkleC}`} data-float="pulse" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" />
      </svg>

      <svg className={`${styles.decorFlower} ${styles.decorFlowerA}`} data-float="drift" viewBox="0 0 32 32" fill="currentColor">
        <ellipse cx="16" cy="8" rx="5" ry="7" />
        <ellipse cx="16" cy="24" rx="5" ry="7" />
        <ellipse cx="8" cy="16" rx="7" ry="5" />
        <ellipse cx="24" cy="16" rx="7" ry="5" />
        <circle cx="16" cy="16" r="4" fill="rgba(255,255,255,0.35)" />
      </svg>
      <svg className={`${styles.decorFlower} ${styles.decorFlowerB}`} data-float="drift" viewBox="0 0 32 32" fill="currentColor">
        <ellipse cx="16" cy="8" rx="5" ry="7" />
        <ellipse cx="16" cy="24" rx="5" ry="7" />
        <ellipse cx="8" cy="16" rx="7" ry="5" />
        <ellipse cx="24" cy="16" rx="7" ry="5" />
        <circle cx="16" cy="16" r="4" fill="rgba(255,255,255,0.3)" />
      </svg>

      <span className={`${styles.decorDot} ${styles.decorDotA}`} data-float="pulse" />
      <span className={`${styles.decorDot} ${styles.decorDotB}`} data-float="pulse" />
      <span className={`${styles.decorDot} ${styles.decorDotC}`} data-float="pulse" />
      <span className={`${styles.decorDot} ${styles.decorDotD}`} data-float="pulse" />
      <span className={`${styles.decorDot} ${styles.decorDotE}`} data-float="pulse" />

      <svg className={styles.decorLines} data-float="drift" viewBox="0 0 400 400" fill="none" stroke="currentColor" strokeWidth="1">
        <line x1="0" y1="320" x2="280" y2="40" />
        <line x1="40" y1="400" x2="360" y2="120" />
      </svg>
    </div>
  );
}
