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

# Windows PowerShell 5.1 turns any stderr line of a native program into a
# terminating error when $ErrorActionPreference is 'Stop'. uv, npm and git
# write progress to stderr, so native calls go through this helper, which
# relaxes the preference for the call and checks the real exit code instead.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Command, [switch]$AllowFailure)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object { "$_" } | Write-Host
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previous }
    if ($code -ne 0 -and -not $AllowFailure) { throw "$What failed (exit code $code)." }
    return ($code -eq 0)
}

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
        Invoke-Native 'Engine install' { uv sync --extra $Backend --python 3.12 --no-progress } | Out-Null
        if ($Backend -eq 'cuda') {
            Step 'Installing TensorRT (about 2 GB, one-off)'
            $ok = Invoke-Native 'TensorRT install' { uv pip install --python $Python @TensorRtPackages --no-progress } -AllowFailure
            if (-not $ok) {
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
            Invoke-Native 'npm ci' { npm ci --no-audit --no-fund } | Out-Null
            Invoke-Native 'UI build' { npm run build } | Out-Null
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
Invoke-Native 'Model download' { & $Cli download rfdetr-small } | Out-Null
Invoke-Native 'Engine check' { & $Cli info } | Out-Null

# ---------------------------------------------------------------- run
Step "Starting AIVision on http://localhost:$Port  (Ctrl+C to stop)"
Write-Host 'The first analysis on an NVIDIA GPU builds a TensorRT engine (1-3 minutes, once per model).'
$serveArgs = @('serve', '--port', $Port)
if (-not $NoBrowser) { $serveArgs += '--open' }
$ErrorActionPreference = 'Continue'
& $Cli @serveArgs
