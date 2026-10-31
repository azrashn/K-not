$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
function Stop-TreeOwned([int]$Number) {
    foreach ($child in Get-CimInstance Win32_Process -Filter "ParentProcessId=$Number") {
        if ($child.ExecutablePath -and ($child.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or $child.CommandLine -like "*$root*")) {
            Stop-TreeOwned ([int]$child.ProcessId)
        }
    }
    Stop-Process -Id $Number -ErrorAction SilentlyContinue
}
foreach ($name in @('frontend','backend','ai')) {
    $file = Join-Path $root "logs\video-$name.pid.json"
    if (-not (Test-Path -LiteralPath $file)) { continue }
    $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $p = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($p -and $p.StartTime.ToUniversalTime().Ticks -eq [long]$record.start -and $record.root -eq $root) {
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
        if ($details.ExecutablePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or $details.CommandLine -like "*$root*") { Stop-TreeOwned $p.Id }
        else { throw "Ownership check failed for $name; nothing stopped." }
    }
}
Write-Host 'Only Knot video development listeners stopped. Databases, volumes and MomentSearch preserved.'
