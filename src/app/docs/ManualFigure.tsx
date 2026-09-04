"use client";

import { useState, type ReactNode } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function manualScreenshotSrc(file: string): string {
  return `${BASE}/docs/manual/screenshots/${file}`;
}

type ManualFigureProps = {
  /** Nombre del archivo en public/docs/manual/screenshots/ */
  file: string;
  alt: string;
  /** Miniatura CSS si el PNG aún no existe o falla la carga */
  fallback: ReactNode;
};

export function ManualFigure({ file, alt, fallback }: ManualFigureProps) {
  const [useFallback, setUseFallback] = useState(false);
  const src = manualScreenshotSrc(file);

  if (useFallback) {
    return <>{fallback}</>;
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG en public/docs/manual/screenshots (generado con npm run docs:screenshots) */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setUseFallback(true)}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          verticalAlign: "middle",
        }}
      />
    </>
  );
}
