#!/usr/bin/env bash
# Guarda adjuntos antes de borrar out/data en el export
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STASH="$ROOT/.export-stash"
PERSIST="$ROOT/../.bocasion-data/notion-attachments"
mkdir -p "$STASH"

if [ -d "$ROOT/out/data/notion-attachments" ]; then
  mkdir -p "$STASH/notion-attachments"
  cp -a "$ROOT/out/data/notion-attachments/." "$STASH/notion-attachments/" 2>/dev/null || true
fi

if [ -d "$PERSIST" ]; then
  mkdir -p "$STASH/persist-notion-attachments"
  cp -a "$PERSIST/." "$STASH/persist-notion-attachments/" 2>/dev/null || true
fi
