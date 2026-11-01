<#
  K-not: tek komutla yerel geliştirme ortamı.

    npm run dev:all      # her şeyi kur/hazırla/başlat (idempotent: istediğin kadar çalıştır)
    npm run dev:stop     # her şeyi durdur
    npm run dev:status   # servislerin durumu

  Yaptığı işler (sırayla):
    1. Docker'daki MySQL'i başlatır ve sağlıklı olmasını bekler
    2. backend/.env ve ai-service/.env dosyalarını TEK kaynaktan eşitler
       (veritabanı adresi, ortak tokenlar, ortak STORAGE_ROOT); eksik gizli değerleri üretir
    3. Eksik bağımlılıkları kurar (npm, Python venv) ve Windows'un engellediği orjson'u düzeltir
    4. Migrasyon + seed (tekrar çalıştırmak güvenli) ve gerekirse backend derlemesi
    5. Backend, AI servisi ve ön yüzü arka planda başlatır; günlükler logs/ altındadır
  Gizli değerler ekrana yazılmaz.
#>
param(
  [switch]$Stop,
  [switch]$Status
)

# Yerel komutların stderr çıktısı betiği düşürmesin; hatalar $LASTEXITCODE ile açıkça kontrol edilir.
$ErrorActionPreference = 'Continue'
$Root     = Split-Path $PSScriptRoot -Parent
$Backend  = Join-Path $Root 'backend'
$Ai       = Join-Path $Root 'ai-service'
$LogDir   = Join-Path $Root 'logs'
$PidFile  = Join-Path $LogDir 'dev-pids.json'
$Ports    = [ordered]@{ backend = 3000; ai = 8100; frontend = 5173 }

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "HATA: $m" -ForegroundColor Red; exit 1 }

# ── .env yardımcıları ──────────────────────────────────────────────────────────
function Get-EnvValue([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return $null }
  foreach ($line in Get-Content $File) {
    if ($line -match "^\s*$Key=(.*)$") {
      $v = $Matches[1] -replace '\s+#.*$', ''
      return $v.Trim().Trim('"')
    }
  }
  return $null
}

function Set-EnvValue([string]$File, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $File) { $lines = @(Get-Content $File) }
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*$Key=") { $found = $true; "$Key=$Value" } else { $line }
  }
  if (-not $found) { $out = @($out) + "$Key=$Value" }
  [IO.File]::WriteAllLines($File, [string[]]@($out), (New-Object Text.UTF8Encoding $false))  # BOM'suz
}

function New-Secret { -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }

function Test-Placeholder($v) { (-not $v) -or ($v -match 'change-me|changeme|replace-me') }

# ── süreç yardımcıları ─────────────────────────────────────────────────────────
function Stop-Tree([int]$ProcId) {
  & taskkill /PID $ProcId /T /F 2>$null | Out-Null
}

function Stop-Dev {
  Info 'Çalışan servisler durduruluyor'
  if (Test-Path $PidFile) {
    $saved = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($p in $saved.PSObject.Properties) { Stop-Tree ([int]$p.Value) }
    Remove-Item $PidFile -Force
  }
  # Önceki oturumlardan kalan, proje portlarını tutan node/python süreçleri
  foreach ($port in $Ports.Values) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -match '^(node|python)') { Stop-Tree $proc.Id }
    }
  }
  Ok 'Tamam (Docker MySQL açık bırakıldı; kapatmak için: docker compose down)'
}

function Test-Url([string]$Url) {
  try { (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3).StatusCode -lt 500 } catch { $false }
}

function Wait-Url([string]$Name, [string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url $Url) { Ok "$Name hazır: $Url"; return $true }
    Start-Sleep -Seconds 2
  }
  Warn "$Name $Seconds sn içinde hazır olmadı. Günlük: logs\$($Name.ToLower()).err.log"
  return $false
}

if ($Stop) { Stop-Dev; exit 0 }

if ($Status) {
  foreach ($k in $Ports.Keys) {
    $url = "http://localhost:$($Ports[$k])"
    if ($k -eq 'backend') { $url += '/health' } elseif ($k -eq 'ai') { $url += '/docs' }
    $state = if (Test-Url $url) { 'ÇALIŞIYOR' } else { 'KAPALI' }
    '{0,-9} {1,-10} {2}' -f $k, $state, $url
  }
  & docker ps --filter name=knot_mysql --format 'mysql     {{.Status}}'
  exit 0
}

New-Item -ItemType Directory -Force $LogDir | Out-Null

# ── 0. Ön koşullar ────────────────────────────────────────────────────────────
Info 'Ön koşullar kontrol ediliyor'
foreach ($tool in 'node', 'npm', 'docker', 'python') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "'$tool' bulunamadı. Kurup yeniden dene." }
}
& docker info 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop çalışmıyor. Önce Docker Desktop''ı aç.' }
Ok 'node, npm, docker, python mevcut; Docker çalışıyor'

Stop-Dev

# ── 1. .env dosyaları ─────────────────────────────────────────────────────────
Info 'Ortam dosyaları hazırlanıyor ve eşitleniyor'
$dockerEnv = Join-Path $Root '.env.docker'
if (-not (Test-Path $dockerEnv)) {
  Copy-Item (Join-Path $Root '.env.docker.example') $dockerEnv
  foreach ($k in 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD') { Set-EnvValue $dockerEnv $k (New-Secret) }
  Warn '.env.docker yoktu; rastgele parolalarla oluşturuldu'
}
foreach ($k in 'MYSQL_ROOT_PASSWORD', 'MYSQL_USER', 'MYSQL_PASSWORD') {
  if (Test-Placeholder (Get-EnvValue $dockerEnv $k)) { Fail ".env.docker içinde $k boş ya da örnek değer. Gerçek bir değer yaz." }
}

$beEnv = Join-Path $Backend '.env'
if (-not (Test-Path $beEnv)) { Copy-Item (Join-Path $Backend '.env.example') $beEnv }
$aiEnv = Join-Path $Ai '.env'
if (-not (Test-Path $aiEnv)) { Copy-Item (Join-Path $Ai '.env.example') $aiEnv }
$rootEnv = Join-Path $Root '.env'
if (-not (Test-Path $rootEnv)) { Copy-Item (Join-Path $Root '.env.example') $rootEnv }

# Veritabanı adresi her zaman Docker ayarlarından türetilir (en sık yaşanan hata buydu).
$dbUser = Get-EnvValue $dockerEnv 'MYSQL_USER'
$dbPass = [uri]::EscapeDataString((Get-EnvValue $dockerEnv 'MYSQL_PASSWORD'))
$dbName = Get-EnvValue $dockerEnv 'MYSQL_DATABASE'; if (-not $dbName) { $dbName = 'knot_dev' }
$dbPort = Get-EnvValue $dockerEnv 'MYSQL_HOST_PORT'; if (-not $dbPort) { $dbPort = '3306' }
Set-EnvValue $beEnv 'DATABASE_URL' "mysql://${dbUser}:${dbPass}@localhost:${dbPort}/${dbName}"

# Ortak gizli değerler: backend kaynak, AI servisi kopyalar.
foreach ($k in 'JWT_SECRET', 'RAG_INTERNAL_API_TOKEN', 'INGEST_CALLBACK_TOKEN') {
  if (Test-Placeholder (Get-EnvValue $beEnv $k)) { Set-EnvValue $beEnv $k (New-Secret) }
}
$storage = Join-Path $Root 'data\storage'
New-Item -ItemType Directory -Force $storage | Out-Null
Set-EnvValue $beEnv 'STORAGE_ROOT' $storage
Set-EnvValue $beEnv 'AI_SERVICE_URL' "http://localhost:$($Ports.ai)"
Set-EnvValue $beEnv 'PORT' "$($Ports.backend)"

Set-EnvValue $aiEnv 'RAG_INTERNAL_API_TOKEN' (Get-EnvValue $beEnv 'RAG_INTERNAL_API_TOKEN')
Set-EnvValue $aiEnv 'INGEST_CALLBACK_TOKEN'  (Get-EnvValue $beEnv 'INGEST_CALLBACK_TOKEN')
Set-EnvValue $aiEnv 'STORAGE_ROOT'           $storage
Set-EnvValue $aiEnv 'NESTJS_INTERNAL_URL'    "http://localhost:$($Ports.backend)"
Set-EnvValue $aiEnv 'INGEST_ENABLED'         'true'
Ok 'DATABASE_URL, tokenlar ve STORAGE_ROOT backend ile ai-service arasında eşitlendi'

# ── 2. Veritabanı ─────────────────────────────────────────────────────────────
Info 'MySQL (Docker) başlatılıyor'
Push-Location $Root
& docker compose --env-file .env.docker up -d --wait
$dockerExit = $LASTEXITCODE
Pop-Location
if ($dockerExit -ne 0) { Fail 'MySQL konteyneri başlatılamadı (docker compose çıktısına bak).' }
Ok 'MySQL sağlıklı'

# ── 3. Bağımlılıklar ──────────────────────────────────────────────────────────
Info 'Bağımlılıklar kontrol ediliyor'
if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Push-Location $Root; & npm install; Pop-Location }
if (-not (Test-Path (Join-Path $Backend 'node_modules'))) { Push-Location $Backend; & npm ci; Pop-Location }

$py = Join-Path $Ai '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Warn 'Python sanal ortamı yok; kuruluyor (torch nedeniyle birkaç dakika sürebilir)'
  Push-Location $Ai
  & python -m venv .venv
  & $py -m pip install --upgrade pip
  & $py -m pip install -e '.[dev,embeddings]'
  Pop-Location
}
# Windows Uygulama Denetimi bazı orjson sürümlerinin .pyd dosyasını engelliyor; çalışan sürümü seç.
& $py -c 'import orjson' 2>$null
if ($LASTEXITCODE -ne 0) {
  Warn 'orjson Windows tarafından engellenmiş; çalışan bir sürüm aranıyor'
  $fixed = $false
  foreach ($v in '3.11.8', '3.10.18', '3.11.5', '3.10.16', '3.10.12') {
    & $py -m pip install --quiet --force-reinstall --no-deps "orjson==$v" 2>$null | Out-Null
    & $py -c 'import orjson' 2>$null
    if ($LASTEXITCODE -eq 0) { Ok "orjson $v çalışıyor"; $fixed = $true; break }
  }
  if (-not $fixed) { Fail 'orjson yüklenemedi (Windows Uygulama Denetimi). Smart App Control''ü kontrol et.' }
}
& $py -c 'import knot_rag, knot_ingest, uvicorn, chromadb' 2>$null
if ($LASTEXITCODE -ne 0) { Fail 'ai-service bağımlılıkları içe aktarılamadı: ai-service klasöründe `.\.venv\Scripts\python.exe -m pip install -e ".[dev,embeddings]"` çalıştır.' }
Ok 'Bağımlılıklar tamam'

# ── 4. Migrasyon, seed, derleme ───────────────────────────────────────────────
Info 'Veritabanı şeması ve başlangıç verisi'
Push-Location $Backend
& npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Migrasyon başarısız.' }
& npm run db:seed:local -- scripts/seed.example.json
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Seed başarısız.' }

$dist = Join-Path $Backend 'dist\main.js'
$needBuild = -not (Test-Path $dist)
if (-not $needBuild) {
  $newest = Get-ChildItem (Join-Path $Backend 'src'), (Join-Path $Backend 'prisma') -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $needBuild = $newest.LastWriteTime -gt (Get-Item $dist).LastWriteTime
}
if ($needBuild) {
  Info 'Backend derleniyor'
  & npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Backend derlemesi başarısız.' }
}
Pop-Location

# ── 5. Servisleri başlat ──────────────────────────────────────────────────────
Info 'Servisler başlatılıyor'
$pids = [ordered]@{}
function Start-Svc([string]$Name, [string]$File, [string[]]$Arguments, [string]$Dir) {
  $p = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Dir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LogDir "$Name.out.log") -RedirectStandardError (Join-Path $LogDir "$Name.err.log")
  $script:pids[$Name] = $p.Id
}

$node = (Get-Command node).Source
Start-Svc 'frontend' $node @('node_modules/vite/bin/vite.js', '--port', "$($Ports.frontend)", '--strictPort') $Root
Start-Svc 'backend'  $node @('--env-file=.env', 'dist/main.js') $Backend

# AI servisi: ayarları uvicorn kendi okur (--env-file); tırnaklı değerler ve satır içi yorumlar doğru işlenir.
Start-Svc 'ai' $py @('-m', 'uvicorn', 'knot_rag.main:app', '--host', '127.0.0.1', '--port', "$($Ports.ai)", '--env-file', '.env') $Ai
$pids | ConvertTo-Json | Set-Content $PidFile

# ── 6. Sağlık kontrolü ────────────────────────────────────────────────────────
Info 'Servislerin hazır olması bekleniyor (AI servisi ilk açılışta modeli indirebilir)'
$okBackend  = Wait-Url 'Backend'  "http://localhost:$($Ports.backend)/health" 60
$okFrontend = Wait-Url 'Frontend' "http://localhost:$($Ports.frontend)" 60
$okAi       = Wait-Url 'AI'       "http://localhost:$($Ports.ai)/docs" 300

# Backend'in AI indeksini kabul edip etmediği (parmak izi/IndexVersion uyuşmazlığı soru-cevabı bozar).
if ($okBackend -and $okAi) {
  try {
    $ready = (Invoke-WebRequest "http://localhost:$($Ports.backend)/ready" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    if ($ready.checks.ai_index -ne 'ok') {
      Warn "AI indeksi uyuşmuyor ('$($ready.checks.ai_index)'): ai-service\.chroma başka bir veritabanından kalmış olabilir."
      Warn "Çözüm: npm run dev:stop, ai-service\.chroma klasörünü yedekleyip/silip npm run dev:all."
    } else { Ok 'AI indeksi backend ile uyumlu' }
  } catch { Warn 'Backend /ready okunamadı' }
}
Write-Host ''
if ($okBackend -and $okFrontend -and $okAi) {
  Write-Host 'Her şey hazır:  http://localhost:5173' -ForegroundColor Green
} else {
  Write-Host 'Bazı servisler hazır değil; logs\ klasöründeki *.err.log dosyalarına bak.' -ForegroundColor Yellow
}
Write-Host 'Durdurmak için:  npm run dev:stop     Durum:  npm run dev:status'
