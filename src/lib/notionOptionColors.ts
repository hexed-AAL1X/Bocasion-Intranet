import type { CSSProperties } from "react";

export const COLOR_PRESETS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16", "#A3E635",
  "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#0EA5E9", "#38BDF8",
  "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#D946EF", "#C026D3",
  "#EC4899", "#F43F5E", "#FB7185", "#78350F", "#1E3A5F", "#065F46", "#047857",
  "#7C2D12", "#4C1D95", "#831843", "#64748B", "#9CA3AF",
  "#0D9488", "#BE185D", "#CA8A04", "#4338CA", "#166534", "#52525B",
] as const;

export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  "Sin empezar": "#9CA3AF",
  Listo: "#10B981",
  Completado: "#3B82F6",
};

const PRESET_COLOR_SET = new Set<string>(COLOR_PRESETS.map((c) => c.toUpperCase()));

function hashLabel(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function paletteColorFor(label: string): string {
  return COLOR_PRESETS[hashLabel(label) % COLOR_PRESETS.length];
}

export function normalizeToPresetColor(color: string, fallbackLabel: string): string {
  const normalized = color.trim().toUpperCase();
  if (PRESET_COLOR_SET.has(normalized)) {
    return COLOR_PRESETS.find((preset) => preset.toUpperCase() === normalized) ?? paletteColorFor(fallbackLabel);
  }
  return paletteColorFor(fallbackLabel);
}

export function resolveOptionHexColor(
  option: string,
  column?: { optionColors?: Record<string, string> } | null,
): string {
  const stored = column?.optionColors?.[option];
  if (stored) return normalizeToPresetColor(stored, option);
  if (DEFAULT_STATUS_COLORS[option]) return normalizeToPresetColor(DEFAULT_STATUS_COLORS[option], option);
  return paletteColorFor(option);
}

export function optionChipStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 15%, var(--bg))`,
    color,
    border: `1.5px solid ${color}`,
    padding: "4px 10px",
    borderRadius: "5px",
    fontSize: "13px",
    fontWeight: "600",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap",
  };
}
