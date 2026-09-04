#!/usr/bin/env bash
# Restaura adjuntos a .bocasion-data (fuera de out/, sobrevive deploys)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STASH="$ROOT/.export-stash"
PERSIST="$ROOT/../.bocasion-data/notion-attachments"
mkdir -p "$PERSIST"

if [ -d "$STASH/persist-notion-attachments" ]; then
  cp -a "$STASH/persist-notion-attachments/." "$PERSIST/" 2>/dev/null || true
fi

if [ -d "$STASH/notion-attachments" ]; then
  cp -a "$STASH/notion-attachments/." "$PERSIST/" 2>/dev/null || true
fi

rm -rf "$STASH"
