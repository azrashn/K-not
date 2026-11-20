#!/usr/bin/env bash
# K-not tek komutla kurulum (macOS / Linux / Windows Git Bash).  Kullanım:  ./setup.sh [--start] [--no-docker ...]
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "HATA: Node.js bulunamadı. https://nodejs.org adresinden LTS (>= 20.19, önerilen 22) kur, sonra tekrar dene." >&2
  exit 1
fi
exec node scripts/setup.mjs "$@"
