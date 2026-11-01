#!/usr/bin/env bash
# Fails if any given path (or, with --all, any tracked file) must never be committed:
# env files, credential/seed output, runtime document storage, PDFs outside test fixtures.
# Gitleaks cannot see some of these (binary, empty or UTF-16 files), so this check is by name.
#
#   scripts/check-forbidden-files.sh --all              # every tracked file
#   scripts/check-forbidden-files.sh --staged           # files staged for commit
#   scripts/check-forbidden-files.sh path [path...]
set -euo pipefail

FORBIDDEN='(^|/)\.env(\.[^/]+)?$|(^|/)seed_output[^/]*$|(^|/)[^/]*passwords?[^/]*\.(txt|csv|json)$|(^|/)[^/]*credentials?[^/]*\.(txt|csv)$|(^|/)(data/storage|storage/documents)/|\.(pem|key|p12|pfx)$|(^|/)id_(rsa|ed25519)$|\.pdf$'
ALLOWED='(^|/)\.env(\.[a-z0-9_-]+)*\.example$|^ai-service/tests/ingest/fixtures/[^/]+\.pdf$'

case "${1:-}" in
  --all) mapfile -t files < <(git ls-files) ;;
  --staged) mapfile -t files < <(git diff --cached --name-only --diff-filter=ACMR) ;;
  *) files=("$@") ;;
esac

bad=0
for f in "${files[@]}"; do
  [ -z "$f" ] && continue
  if [[ "$f" =~ $FORBIDDEN ]] && ! [[ "$f" =~ $ALLOWED ]]; then
    echo "forbidden file: $f" >&2
    bad=1
  fi
done
if [ "$bad" -ne 0 ]; then
  echo "These files must not be committed (secrets, runtime data or third-party documents)." >&2
  echo "Unstage them with: git rm --cached <file>  (the local copy is kept)" >&2
  exit 1
fi
