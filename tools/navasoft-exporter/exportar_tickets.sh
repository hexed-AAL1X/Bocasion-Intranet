#!/usr/bin/env bash
# Sincroniza tickets Navasoft con el dashboard desde la PC local.
# Usa la PC local (sí llega a la intranet). Yachay no puede scrapear Navasoft.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Carga opcional de credenciales desde archivo local (no subir a git).
# Se filtra el \r por si el archivo se editó/copió desde Windows (CRLF).
if [[ -f "$ROOT/export.env" ]]; then
  # shellcheck disable=SC1090
  source <(tr -d '\r' < "$ROOT/export.env")
fi

USUARIO="${NAV_USUARIO:-}"
CONTRASENA="${NAV_CONTRASENA:-}"
BASE_URL="${NAV_BASE_URL:-http://38.210.1.85:85}"
ESTADO="${NAV_ESTADO:-todos}"
DESDE="${NAV_DESDE:-01/01/2010}"
HASTA="${NAV_HASTA:-$(date +%d/%m/%Y)}"

if [[ -z "$USUARIO" || -z "$CONTRASENA" ]]; then
  echo "Faltan NAV_USUARIO o NAV_CONTRASENA en export.env."
  exit 1
fi

OUT_DIR="${NAV_OUT_DIR:-$ROOT/exports}"
mkdir -p "$OUT_DIR"
SALIDA="${NAV_SALIDA:-$OUT_DIR/tickets_navasoft.json}"

PYTHON=""
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
else
  echo "No hay Python 3. Instala python3 o crea el venv del proyecto."
  exit 1
fi

echo "=============================================="
echo "  Sincronizador Navasoft -> Dashboard"
echo "=============================================="
echo
echo "  Usuario : $USUARIO"
echo "  Estado  : $ESTADO"
echo "  Desde   : $DESDE"
echo "  Hasta   : $HASTA"
echo "  Destino : Tickets del dashboard"
echo

"$PYTHON" "$ROOT/ticket_exporter.py" \
  --usuario "$USUARIO" \
  --contrasena "$CONTRASENA" \
  --base-url "$BASE_URL" \
  --estado "$ESTADO" \
  --desde "$DESDE" \
  --hasta "$HASTA" \
  --salida "$SALIDA" \
  --modo-batch

echo
echo "Datos listos para actualizar Tickets"
echo

# En modo agente (PAUSE_AT_END=0) no mostrar notificaciones de escritorio:
# notify-send puede colgarse sin sesión gráfica y dejar el job en 98%.
if [[ "${PAUSE_AT_END:-1}" == "1" ]] && command -v notify-send >/dev/null 2>&1; then
  notify-send "Tickets Navasoft" "Datos listos para sincronizar" || true
fi

# Si se lanzo desde el boton .desktop, deja la ventana abierta
if [[ "${PAUSE_AT_END:-1}" == "1" ]] && [[ -t 0 ]]; then
  read -r -p "Enter para cerrar..." || true
fi
