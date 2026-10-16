# Build the POSNIC Windows installer locally, without GitHub Actions.
# Run from the repository root in PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\build-windows-local.ps1
# This intentionally does not run tests and never pushes or merges code.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install Node.js 22 LTS and Git for Windows, then reopen PowerShell."
    }
}
Require-Command 'node'
Require-Command 'npm'
$nodeMajor = [int]((node -p "process.versions.node.Split('.')[0]").Trim())
if ($nodeMajor -ne 22) { Write-Warning "This repository's Windows build workflow uses Node.js 22; detected Node.js $nodeMajor." }

$root = (Get-Location).Path
if (-not (Test-Path (Join-Path $root 'package.json')) -or -not (Test-Path (Join-Path $root 'src\main.js'))) {
    throw "Run this script from the POSNIC repository root (the folder containing package.json and src\main.js)."
}
if (-not (Test-Path (Join-Path $root 'api\package.json')) -or -not (Test-Path (Join-Path $root 'frontend\package.json'))) {
    throw "The api or frontend project folder is missing. Make sure the development branch is fully checked out."
}

Write-Host "[1/6] Installing root dependencies..." -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Root npm ci failed.' }

Write-Host "[2/6] Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'frontend')
try { npm ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend npm ci failed.' } } finally { Pop-Location }

Write-Host "[3/6] Installing API dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'api')
try { npm ci; if ($LASTEXITCODE -ne 0) { throw 'API npm ci failed.' } } finally { Pop-Location }

Write-Host "[4/6] Downloading the bundled MongoDB binary..." -ForegroundColor Cyan
$downloadBat = Get-Content (Join-Path $root 'src\download-mongodb.bat') -Raw
$versionMatch = [regex]::Match($downloadBat, '(?im)^\s*set\s+MONGODB_VERSION\s*=\s*([0-9.]+)')
if (-not $versionMatch.Success) { throw "Could not read MONGODB_VERSION from src\download-mongodb.bat." }
$mongoVersion = $versionMatch.Groups[1].Value
$mongoUrl = "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$mongoVersion.zip"
$tempRoot = Join-Path $root 'mongodb-build-temp'
$zipPath = Join-Path $root 'mongodb-build-temp.zip'
$mongoBin = Join-Path $root 'mongodb\bin'
New-Item -ItemType Directory -Force -Path $tempRoot, $mongoBin | Out-Null
try {
    Invoke-WebRequest -Uri $mongoUrl -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $tempRoot -Force
    $mongod = Get-ChildItem -Path $tempRoot -Filter 'mongod.exe' -Recurse -File | Select-Object -First 1
    if (-not $mongod) { throw "mongod.exe was not found in the archive from $mongoUrl." }
    Copy-Item -LiteralPath $mongod.FullName -Destination (Join-Path $mongoBin 'mongod.exe') -Force
    foreach ($dll in @('msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        $dllPath = Join-Path $env:WINDIR "System32\$dll"
        if (-not (Test-Path $dllPath)) { throw "Required Windows runtime file is missing: $dllPath" }
        Copy-Item -LiteralPath $dllPath -Destination (Join-Path $mongoBin $dll) -Force
    }
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
}

Write-Host "[5/6] Preparing bundled frontend, API runtime, VC runtime and sync agent..." -ForegroundColor Cyan
npm run prepare:bundle
if ($LASTEXITCODE -ne 0) { throw 'prepare:bundle failed.' }
node scripts/check-mongodb-binaries.js
if ($LASTEXITCODE -ne 0) { throw 'MongoDB binary check failed.' }

Write-Host "[6/6] Building Windows x64 installer (tests are not run)..." -ForegroundColor Cyan
npx electron-builder --win --x64 --publish never --config.win.verifyUpdateCodeSignature=false
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed.' }
Write-Host "Build finished. Installer files are in the dist folder:" -ForegroundColor Green
Get-ChildItem (Join-Path $root 'dist') -Filter '*.exe' -File | Select-Object FullName, Length, LastWriteTime
