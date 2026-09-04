import path from "path";

/**
 * Directorio privado para datos persistentes de la aplicación.
 * NUNCA debe estar dentro de `public/` ya que Next.js lo sirve estáticamente.
 */
export const DATA_DIR = path.join(process.cwd(), ".data");
