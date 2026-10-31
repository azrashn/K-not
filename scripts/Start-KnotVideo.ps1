param([string]$MomentSearchRoot = (Join-Path $env:USERPROFILE 'Documents\Codex\MomentSearch'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null
function Env-Value([string]$Path, [string]$Key) {
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$Key=(.*)$") { return $Matches[1].Trim().Trim('"').Trim("'") }
    }
    throw "Missing $Key in local configuration."
}
function Start-Local([string]$Name, [int]$Port, [string]$Exe, [string[]]$Arguments, [string]$Directory) {
    $pidFile = Join-Path $root "logs\video-$Name.pid.json"
    if (Test-Path -LiteralPath $pidFile) {
        $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $p = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.ToUniversalTime().Ticks -eq [long]$saved.start) { Write-Host "$Name already running"; return }
    }
    # Windows CIM can report a stale PID-0 entry after a listener closes.
    # Only a live process owning a listening socket is a port conflict.
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 }) {
        throw "Port $Port occupied. No process was stopped."
    }
    $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Directory -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root "logs\video-$Name.out.log") -RedirectStandardError (Join-Path $root "logs\video-$Name.err.log")
    @{pid=$p.Id;start=$p.StartTime.ToUniversalTime().Ticks;root=$root} | ConvertTo-Json | Set-Content -LiteralPath $pidFile
}
function Wait-Ready([string]$Url) {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        try { $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2; return } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "Service did not become ready: $Url. Check Knot logs."
}
# Compose starts only Knot's own DB, preserving its named volume.
docker compose --env-file .env.docker up -d --wait db
if ($LASTEXITCODE -ne 0) { throw 'Knot database did not start.' }
# A small one-shot tool, never a persistent Office service or another app's container.
$null = docker image inspect knot-office-renderer:local-v1 2>$null
if ($LASTEXITCODE -ne 0) {
    docker build -t knot-office-renderer:local-v1 -f tools/office-renderer/Dockerfile tools/office-renderer
    if ($LASTEXITCODE -ne 0) { throw 'Knot Office renderer build failed. No existing service was stopped.' }
}
Push-Location -LiteralPath (Join-Path $root 'backend')
try {
    & node node_modules/prisma/build/index.js generate
    if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed.' }
    & node node_modules/prisma/build/index.js migrate deploy
    if ($LASTEXITCODE -ne 0) { throw 'Additive migrations failed; no reset performed.' }
    & node node_modules/typescript/bin/tsc -p tsconfig.build.json
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
} finally { Pop-Location }
$videoRoot = $MomentSearchRoot
if (-not (Test-Path -LiteralPath (Join-Path $videoRoot 'Start-MomentSearch.ps1'))) { throw 'MomentSearch installation is missing. See docs/video-integration.md.' }
& (Join-Path $videoRoot 'Start-MomentSearch.ps1')
Set-Location -LiteralPath $root
# Runtime secrets are read from the ignored local file, never literals in source.
Set-Item -Path Env:RAG_INTERNAL_API_TOKEN -Value (Env-Value (Join-Path $root 'backend\.env') 'RAG_INTERNAL_API_TOKEN')
Set-Item -Path Env:INGEST_CALLBACK_TOKEN -Value (Env-Value (Join-Path $root 'backend\.env') 'INGEST_CALLBACK_TOKEN')
$env:STORAGE_ROOT = Env-Value (Join-Path $root 'backend\.env') 'STORAGE_ROOT'
$env:NESTJS_INTERNAL_URL = 'http://127.0.0.1:3100'
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:3100'
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
$pdfRenderer=Get-Command pdftoppm -ErrorAction SilentlyContinue
if ($pdfRenderer) { $env:PDFTOPPM_PATH=$pdfRenderer.Source }
else {
    $bundledPoppler=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
    if (Test-Path -LiteralPath $bundledPoppler) { $env:PDFTOPPM_PATH=$bundledPoppler }
    else { Write-Warning 'pdftoppm is missing. Original visual previews need Poppler; text retrieval remains available. See PRODUCT_LOCAL_SETUP.md.' }
}
# Reuse only the already installed, isolated 2B Instruct model. No download,
# shared Ollama change or paid endpoint; absent model leaves honest excerpts.
$env:UNIFIED_LLM_BASE_URL = ''
$env:UNIFIED_LLM_MODEL = ''
try {
    $models = (Invoke-RestMethod -Uri 'http://127.0.0.1:11436/api/tags' -TimeoutSec 3).models
    $localModel = $models | Where-Object { $_.name -match '2b' -and $_.name -match 'instruct' } | Select-Object -First 1
    if ($localModel) {
        $env:UNIFIED_LLM_BASE_URL = 'http://127.0.0.1:11436/v1'
        $env:UNIFIED_LLM_MODEL = $localModel.name
    }
} catch { Write-Host 'Unified explanation model unavailable; source excerpts remain usable.' }
Start-Local 'ai' 8110 (Join-Path $root 'ai-service\.venv\Scripts\python.exe') @('-m','uvicorn','knot_rag.main:app','--host','127.0.0.1','--port','8110','--env-file','.env') (Join-Path $root 'ai-service')
Wait-Ready 'http://127.0.0.1:8110/health'
Start-Local 'backend' 3100 (Get-Command node).Source @((Join-Path $root 'scripts\video-backend.cjs')) $root
Start-Local 'frontend' 5174 (Get-Command node).Source @((Join-Path $root 'node_modules\vite\bin\vite.js'),'--host','127.0.0.1','--port','5174','--strictPort') $root
Wait-Ready 'http://127.0.0.1:3100/health'
Wait-Ready 'http://127.0.0.1:5174/'
Write-Host 'K-not video: http://127.0.0.1:5174/#/dersler'
Write-Host 'Open a course, then Ders videolari. Upload a file or add a public YouTube / Drive video link.'
