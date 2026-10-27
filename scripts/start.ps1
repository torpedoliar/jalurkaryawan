[CmdletBinding()]
param(
    [ValidateSet('live', 'mock')][string]$Mode = 'live',
    [ValidateSet('', 'api', 'web')][string]$Service = '',
    [int]$WebPort = 5241,
    [int]$ApiPort = 3000,
    [int]$DatabasePort = 5434,
    [switch]$NoBrowser,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Local = Join-Path $Root '.local'
$Compose = Join-Path $PSScriptRoot 'compose.dev.yml'

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command gagal (exit $LASTEXITCODE)." }
}
function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name tidak ditemukan. Install prasyarat terlebih dahulu (lihat docs/start-aplikasi.md)." }
}
function Assert-FreePort([int]$Port) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() }
    catch { throw "Port $Port sedang dipakai atau dicadangkan Windows. Gunakan parameter port lain." }
    finally { $listener.Stop() }
}
function Wait-Http([string]$Url, [int]$Seconds = 90) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        try { $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2; if ($r.StatusCode -eq 200) { return } } catch { }
        Start-Sleep -Seconds 1
    }
    throw "Aplikasi belum siap di $Url. Periksa jendela service untuk detail error."
}
function Set-LiveEnvironment {
    $secretFile = Join-Path $Local 'app-secret'
    if (-not (Test-Path $secretFile)) { throw 'Secret development belum dibuat. Jalankan start.bat tanpa parameter Service.' }
    $env:APP_SECRET = [System.IO.File]::ReadAllText($secretFile).Trim()
    $env:DATABASE_URL = "postgresql://bms:bms_local_dev@127.0.0.1:$DatabasePort/bms_dev"
    $env:PORT = "$ApiPort"
    $env:APP_DOMAIN = "http://127.0.0.1:$WebPort"
    $env:BACKUP_DIR = Join-Path $Local 'backups'
}

try {
    Set-Location $Root
    Require-Command 'node'
    Require-Command 'pnpm.cmd'
    $major = [int]((& node --version).TrimStart('v').Split('.')[0])
    if ($major -lt 22) { throw 'Gunakan Node.js 22 atau lebih baru.' }
    if ($Mode -eq 'live') { Require-Command 'docker' }
    if ($Check) {
        if ($Mode -eq 'live') { Invoke-Checked 'docker' @('info', '--format', '{{.ServerVersion}}') }
        Write-Host "Prasyarat tersedia. Mode=$Mode Web=$WebPort API=$ApiPort Database=$DatabasePort" -ForegroundColor Green
        exit 0
    }

    if ($Service) {
        if ($Service -eq 'api') {
            Set-LiveEnvironment
            Set-Location (Join-Path $Root 'apps/api')
            Invoke-Checked 'pnpm.cmd' @('dev')
        } else {
            $env:VITE_USE_MOCK = if ($Mode -eq 'mock') { 'true' } else { 'false' }
            $env:VITE_PORT = "$WebPort"
            $env:VITE_API_URL = "http://127.0.0.1:$ApiPort"
            Set-Location (Join-Path $Root 'apps/web')
            Invoke-Checked 'pnpm.cmd' @('dev')
        }
        exit 0
    }

    Assert-FreePort $WebPort
    if ($Mode -eq 'live') { Assert-FreePort $ApiPort }
    if (-not (Test-Path (Join-Path $Root 'node_modules/.pnpm'))) {
        Write-Host 'Menginstall dependencies...'
        Invoke-Checked 'pnpm.cmd' @('install', '--frozen-lockfile')
    }
    if ($Mode -eq 'live') {
        Invoke-Checked 'docker' @('info', '--format', '{{.ServerVersion}}')
        New-Item -ItemType Directory -Force -Path $Local | Out-Null
        $secretFile = Join-Path $Local 'app-secret'
        if (-not (Test-Path $secretFile)) {
            $bytes = New-Object byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
            [System.IO.File]::WriteAllText($secretFile, ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()))
        }
        Set-LiveEnvironment
        $env:BMS_DEV_DB_PORT = "$DatabasePort"
        Invoke-Checked 'docker' @('compose', '-p', 'bms-local-dev', '-f', $Compose, 'up', '-d', '--wait', 'postgres')
        Push-Location (Join-Path $Root 'apps/api')
        try {
            Invoke-Checked 'pnpm.cmd' @('exec', 'prisma', 'generate')
            Invoke-Checked 'pnpm.cmd' @('exec', 'prisma', 'migrate', 'deploy')
        } finally { Pop-Location }
        $argsApi = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Service', 'api', '-Mode', 'live', '-ApiPort', "$ApiPort", '-DatabasePort', "$DatabasePort", '-WebPort', "$WebPort")
        Start-Process 'powershell.exe' -ArgumentList $argsApi -WorkingDirectory $Root | Out-Null
        Wait-Http "http://127.0.0.1:$ApiPort/api/health"
    }
    $argsWeb = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Service', 'web', '-Mode', $Mode, '-WebPort', "$WebPort", '-ApiPort', "$ApiPort")
    Start-Process 'powershell.exe' -ArgumentList $argsWeb -WorkingDirectory $Root | Out-Null
    $url = "http://127.0.0.1:$WebPort"
    Wait-Http $url
    Write-Host "Aplikasi siap: $url (mode $Mode)" -ForegroundColor Green
    Write-Host 'Hentikan web/API dengan Ctrl+C di masing-masing jendela service.'
    if ($Mode -eq 'live') {
        Write-Host 'Database development terpisah dari test/produksi; data tidak dihapus saat aplikasi ditutup.'
        Write-Host 'Database baru akan menampilkan Setup Awal untuk membuat Super Admin. Seed tidak dijalankan otomatis.'
    } else { Write-Host 'Demo: admin / demo1234, 00012345 / demo1234, driver / demo1234. Data mock hilang saat halaman dimuat ulang.' }
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    Write-Host "Gagal start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
