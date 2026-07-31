#!/usr/bin/env bash
# Copia o codigo (sem node_modules/.next) para a pasta do repositorio.
set -e
SRC=/tmp/h2
DST=/sessions/zealous-blissful-goldberg/mnt/outputs/H2-medicina
cd "$SRC"
find . \( -path ./node_modules -o -path ./.next -o -path ./.git \) -prune -o -type f -print |
while IFS= read -r f; do
  rel="${f#./}"
  mkdir -p "$DST/$(dirname "$rel")" 2>/dev/null || true
  cp "$f" "$DST/$rel" 2>/dev/null || { : > "$DST/$rel" && cat "$f" > "$DST/$rel"; }
done
echo "sincronizado -> $DST"
