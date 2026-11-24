<#
.SYNOPSIS
    Installs (first run) and starts the AIVision traffic counter on Windows.

.DESCRIPTION
    1. Installs uv (Python package manager) for the current user if missing.
    2. Creates engine\.venv with Python 3.12 and the matching ONNX Runtime:
       NVIDIA GPU  -> CUDA + cuDNN + TensorRT (all from pip, no CUDA toolkit needed)
       other GPU   -> DirectML
       no GPU      -> CPU
    3. Builds the web UI if Node.js is available and the build is missing or stale.
    4. Downloads the default detection model on first use.
    5. Starts the engine and opens http://localhost:8000.

    Nothing is installed system-wide. Delete engine\.venv to start over.

.PARAMETER Backend
    auto (default), cuda, directml or cpu.

.PARAMETER Port
    HTTP port for the UI (default 8000).

.PARAMETER NoBrowser
    Do not open the browser.
#>
[CmdletBinding()]
param(
    [ValidateSet('auto', 'cuda', 'directml', 'cpu')]
    [string]$Backend = 'auto',
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = $PSScriptRoot
$Engine = Join-Path $Root 'engine'
$Web = Join-Path $Root 'web'
$Venv = Join-Path $Engine '.venv'
$Python = Join-Path $Venv 'Scripts\python.exe'
$Cli = Join-Path $Venv 'Scripts\aivision.exe'
$TensorRtPackages = @('tensorrt-cu13-libs==10.16.1.11', 'tensorrt-cu13-bindings==10.16.1.11')

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Yellow }

# ------------------------------------------------------------------ uv
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Step 'Installing uv (Python package manager)'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

# ------------------------------------------------------------- backend
if ($Backend -eq 'auto') {
    $gpuNames = (Get-CimInstance Win32_VideoController).Name -join '; '
    if ($gpuNames -match 'NVIDIA') { $Backend = 'cuda' }
    elseif ($gpuNames -match 'AMD|Radeon|Intel|Arc') { $Backend = 'directml' }
    else { $Backend = 'cpu' }
    Write-Host "Detected GPU(s): $gpuNames -> using '$Backend'"
}

# ---------------------------------------------------------- python env
$marker = Join-Path $Venv ".backend-$Backend"
if (-not (Test-Path $marker)) {
    Step "Installing the engine ($Backend). The first install downloads 1-3 GB; this can take a while."
    Push-Location $Engine
    try {
        uv sync --extra $Backend --python 3.12 --no-progress
        if ($LASTEXITCODE -ne 0) { throw 'uv sync failed' }
        if ($Backend -eq 'cuda') {
            Step 'Installing TensorRT (about 2 GB, one-off)'
            uv pip install --python $Python @TensorRtPackages --no-progress
            if ($LASTEXITCODE -ne 0) {
                Write-Warning 'TensorRT could not be installed; the engine will use plain CUDA instead (about 35% slower).'
            }
        }
        Get-ChildItem $Venv -Filter '.backend-*' -Force -ErrorAction SilentlyContinue | Remove-Item -Force
        New-Item -ItemType File -Path $marker -Force | Out-Null
    }
    finally { Pop-Location }
}

# ------------------------------------------------------------------ UI
$dist = Join-Path $Web 'dist\index.html'
$newestSource = Get-ChildItem (Join-Path $Web 'src'), (Join-Path $Web 'index.html') -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$stale = -not (Test-Path $dist) -or ($newestSource.LastWriteTime -gt (Get-Item $dist).LastWriteTime)
if ($stale) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Step 'Building the web UI'
        Push-Location $Web
        try {
            npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
            npm run build
            if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
        }
        finally { Pop-Location }
    }
    elseif (-not (Test-Path $dist)) {
        throw 'The web UI is not built and Node.js is not installed. Install Node.js LTS (winget install OpenJS.NodeJS.LTS) and run this script again.'
    }
    else {
        Write-Warning 'The UI sources changed but Node.js is missing, so the existing build is used.'
    }
}

# --------------------------------------------------------------- model
Step 'Checking the detection model'
& $Cli download rfdetr-small
if ($LASTEXITCODE -ne 0) { throw 'Model download failed' }
& $Cli info

# ---------------------------------------------------------------- run
Step "Starting AIVision on http://localhost:$Port  (Ctrl+C to stop)"
Write-Host 'The first analysis on an NVIDIA GPU builds a TensorRT engine (1-3 minutes, once per model).'
$serveArgs = @('serve', '--port', $Port)
if (-not $NoBrowser) { $serveArgs += '--open' }
& $Cli @serveArgs
