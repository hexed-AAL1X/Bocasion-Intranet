import type { UserRole } from "@/components/AuthGate";

/** Áreas/departamentos del workspace (mismas secciones del sidebar, sin Inicio). */
export const DEPARTMENT_AREAS = [
  "Administrativo",
  "Tecnología e Informática",
  "Calidad",
  "Contabilidad y Finanzas",
  "Recursos Humanos",
  "Logística",
  "Operaciones",
] as const;

export type DepartmentArea = (typeof DEPARTMENT_AREAS)[number];

/** id de sección del sidebar → nombre de área oficial */
export const NAV_SECTION_AREA: Record<string, DepartmentArea | null> = {
  inicio: null,
  administrativo: "Administrativo",
  ti: "Tecnología e Informática",
  calidad: "Calidad",
  finanzas: "Contabilidad y Finanzas",
  rrhh: "Recursos Humanos",
  logistica: "Logística",
  operaciones: "Operaciones",
};

/** Rutas del dashboard → área requerida (null = libre para cualquier sesión) */
export const PATH_AREA_ACCESS: { prefix: string; area: DepartmentArea | null }[] = [
  { prefix: "/usuarios", area: "Administrativo" },
  { prefix: "/analisis", area: "Administrativo" },
  { prefix: "/tickets", area: "Tecnología e Informática" },
  { prefix: "/equipos", area: "Tecnología e Informática" },
  { prefix: "/docs", area: "Tecnología e Informática" },
  { prefix: "/alertas", area: "Tecnología e Informática" },
  { prefix: "/programa-anual", area: "Calidad" },
  { prefix: "/rrhh", area: "Recursos Humanos" },
  { prefix: "/notion", area: null },
  { prefix: "/", area: null },
];

export function isDepartmentArea(value: string): value is DepartmentArea {
  return (DEPARTMENT_AREAS as readonly string[]).includes(value);
}

/** Filtra áreas a solo las oficiales del menú. */
export function sanitizeDepartmentAreas(areas: unknown): string[] {
  if (!Array.isArray(areas)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of areas) {
    const area = String(raw ?? "").trim();
    if (!area || !isDepartmentArea(area) || seen.has(area)) continue;
    seen.add(area);
    out.push(area);
  }
  return out;
}

/** Dev tiene acceso total; el resto solo a sus áreas asignadas. */
export function userCanAccessArea(
  role: UserRole | string | null | undefined,
  userAreas: string[] | null | undefined,
  area: DepartmentArea | null | undefined
): boolean {
  if (area == null) return true;
  if (role === "dev") return true;
  const allowed = sanitizeDepartmentAreas(userAreas ?? []);
  return allowed.includes(area);
}

export function userCanAccessNavSection(
  role: UserRole | string | null | undefined,
  userAreas: string[] | null | undefined,
  sectionId: string
): boolean {
  const area = Object.prototype.hasOwnProperty.call(NAV_SECTION_AREA, sectionId)
    ? NAV_SECTION_AREA[sectionId]
    : null;
  return userCanAccessArea(role, userAreas, area);
}

export function requiredAreaForPath(pathname: string): DepartmentArea | null {
  const path = pathname.split("?")[0] || "/";
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  // Más específico primero
  const ranked = [...PATH_AREA_ACCESS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of ranked) {
    if (rule.prefix === "/") {
      if (normalized === "/" || normalized === "") return rule.area;
      continue;
    }
    if (normalized === rule.prefix || normalized.startsWith(`${rule.prefix}/`)) {
      return rule.area;
    }
  }
  return null;
}

export function userCanAccessPath(
  role: UserRole | string | null | undefined,
  userAreas: string[] | null | undefined,
  pathname: string
): boolean {
  return userCanAccessArea(role, userAreas, requiredAreaForPath(pathname));
}
