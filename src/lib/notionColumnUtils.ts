type ColumnLike = {
  type?: string;
  id?: string;
  title?: string;
  savedTitle?: string;
  sort?: string;
};

/** Columna ID de Notion: numeración automática por fila (no valor almacenado). */
export function isAutoIdColumn(col: ColumnLike): boolean {
  const type = String(col.type ?? "").trim().toLowerCase();
  if (type === "id") return true;
  const colId = String(col.id ?? "").trim().toLowerCase();
  if (/^custom_id_\d+$/.test(colId)) return true;
  return false;
}

export function getIdColumnLabel(col: ColumnLike): string {
  const label = String(col.title || col.savedTitle || "ID").trim();
  return label || "ID";
}

export function getAutoIdValue(rowIndex: number): number {
  return rowIndex + 1;
}

export function getRowStableIndex<T extends { id?: unknown }>(row: T, sourceRows: T[]): number {
  const rowId = row.id;
  if (rowId !== undefined && rowId !== null && rowId !== "") {
    const idx = sourceRows.findIndex((r) => r.id === rowId);
    if (idx >= 0) return idx;
  }
  const refIdx = sourceRows.indexOf(row);
  return refIdx >= 0 ? refIdx : sourceRows.length;
}

/** Ordena filas según la columna activa (Asc/Desc). ID usa el orden original de la tabla. */
export function sortRowsByStoredColumn<T extends Record<string, unknown>>(
  rows: T[],
  sourceRows: T[],
  col: ColumnLike,
  readField: (row: T) => unknown,
  formatLocation?: (value: unknown) => string,
): T[] {
  if (col.sort !== "Asc" && col.sort !== "Desc") return rows;
  const direction = col.sort === "Desc" ? -1 : 1;

  if (isAutoIdColumn(col)) {
    return [...rows].sort(
      (a, b) => (getRowStableIndex(a, sourceRows) - getRowStableIndex(b, sourceRows)) * direction,
    );
  }

  const normalize = (value: unknown) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object" && formatLocation) return formatLocation(value).trim();
    return String(value).trim();
  };

  return [...rows].sort((a, b) => {
    const aText = normalize(readField(a));
    const bText = normalize(readField(b));
    const aNumber = Number(aText.replace(",", "."));
    const bNumber = Number(bText.replace(",", "."));
    if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber) && aText !== "" && bText !== "") {
      return (aNumber - bNumber) * direction;
    }
    const aDate = Date.parse(aText);
    const bDate = Date.parse(bText);
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) return (aDate - bDate) * direction;
    return aText.localeCompare(bText, "es", { sensitivity: "base", numeric: true }) * direction;
  });
}
