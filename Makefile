# K-not kısayolları (macOS / Linux / WSL). Windows için: setup.bat veya `npm run setup`.
.PHONY: setup start stop status test
setup:   ; node scripts/setup.mjs
start:   ; node scripts/dev.mjs start
stop:    ; node scripts/dev.mjs stop
status:  ; node scripts/dev.mjs status
test:    ; npm test && cd backend && npm run test:unit && cd ../ai-service && .venv/bin/python -m pytest -q
