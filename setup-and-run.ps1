[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5173,

    [ValidateRange(5, 300)]
    [int]$LaunchTimeoutSeconds = 90,

    [switch]$SkipInstall,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$MinimumNode20 = [version]'20.19.0'
$MinimumNode22 = [version]'22.12.0'
$ProjectRoot = $PSScriptRoot
$WebRoot = Join-Path $ProjectRoot 'web'
$AppUrl = "http://localhost:$Port/"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Update-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machinePath, $userPath) -join ';'
}

function Get-InstalledNodeVersion {
    $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        return $null
    }

    $rawVersion = (& $nodeCommand.Source --version).Trim().TrimStart('v')
    try {
        return [version]$rawVersion
    }
    catch {
        throw "Node.js returned an unrecognized version: $rawVersion"
    }
}

function Test-SupportedNodeVersion {
    param([AllowNull()][version]$Version)

    if ($null -eq $Version) {
        return $false
    }

    return (($Version.Major -eq 20 -and $Version -ge $MinimumNode20) -or $Version -ge $MinimumNode22)
}

function Install-NodeLts {
    $wingetCommand = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if ($null -eq $wingetCommand) {
        throw @'
Node.js is missing or too old, and Windows Package Manager (winget) is unavailable.
Install the current Node.js LTS release from https://nodejs.org/, reopen PowerShell,
and run this script again.
'@
    }

    Write-Step 'Installing the current Node.js LTS release with winget'
    $commonArguments = @(
        '--id', 'OpenJS.NodeJS.LTS',
        '--exact',
        '--source', 'winget',
        '--accept-package-agreements',
        '--accept-source-agreements'
    )

    $existingVersion = Get-InstalledNodeVersion
    if ($null -eq $existingVersion) {
        & $wingetCommand.Source install @commonArguments
    }
    else {
        & $wingetCommand.Source upgrade @commonArguments
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'The package was not upgradeable; asking winget to install the LTS package.' -ForegroundColor Yellow
            & $wingetCommand.Source install @commonArguments
        }
    }

    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install Node.js LTS (exit code $LASTEXITCODE)."
    }

    Update-ProcessPath
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    & "$env:SystemRoot\System32\taskkill.exe" /PID $ProcessId /T /F 2>$null | Out-Null
}

if ($env:OS -ne 'Windows_NT') {
    throw 'This launcher is intended for Windows. On Linux or macOS, run npm install and npm run dev from web/.'
}

if (-not (Test-Path -LiteralPath (Join-Path $WebRoot 'package.json'))) {
    throw "Cannot find web/package.json. Keep this script in the project root and run it from there."
}

Write-Host 'AIVision Traffic Counter — Windows setup' -ForegroundColor Green
Write-Host "Project: $ProjectRoot"

$nodeVersion = Get-InstalledNodeVersion
if (-not (Test-SupportedNodeVersion -Version $nodeVersion)) {
    if ($null -eq $nodeVersion) {
        Write-Host 'Node.js is not installed.' -ForegroundColor Yellow
    }
    else {
        Write-Host "Node.js $nodeVersion is unsupported. Vite requires Node.js 20.19+ or 22.12+." -ForegroundColor Yellow
    }

    Install-NodeLts
    $nodeVersion = Get-InstalledNodeVersion
}

if (-not (Test-SupportedNodeVersion -Version $nodeVersion)) {
    throw @"
A supported Node.js version is still unavailable after installation.
Close this terminal, open a new PowerShell window, and rerun the script.
Detected version: $nodeVersion
"@
}

$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    throw 'npm.cmd was not found even though Node.js is installed. Reinstall Node.js LTS and rerun the script.'
}

Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
Write-Host "npm: $((& $npmCommand.Source --version).Trim())" -ForegroundColor Green

$requiredModelFiles = @(
    'public\models\onnx-community\yolov10n\config.json',
    'public\models\onnx-community\yolov10n\preprocessor_config.json',
    'public\models\onnx-community\yolov10n\onnx\model.onnx',
    'public\models\onnx-community\yolov10n\onnx\model_quantized.onnx'
)

$missingModelFiles = @(
    foreach ($relativePath in $requiredModelFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $WebRoot $relativePath))) {
            $relativePath
        }
    }
)

if ($missingModelFiles.Count -gt 0) {
    throw "Required local model files are missing:`n - $($missingModelFiles -join "`n - ")`nRestore the complete repository before launching the app."
}

if (-not $SkipInstall) {
    Write-Step 'Installing exact web dependencies from package-lock.json'
    Push-Location $WebRoot
    try {
        & $npmCommand.Source ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
else {
    if (-not (Test-Path -LiteralPath (Join-Path $WebRoot 'node_modules'))) {
        throw '-SkipInstall was specified, but web/node_modules does not exist.'
    }
    Write-Host 'Dependency installation skipped.' -ForegroundColor Yellow
}

Write-Step "Launching the app at $AppUrl"
$npmPath = $npmCommand.Source
$serverCommand = "title AIVision Traffic Counter && `"$npmPath`" run dev -- --host 127.0.0.1 --port $Port --strictPort"
$serverProcess = Start-Process `
    -FilePath "$env:SystemRoot\System32\cmd.exe" `
    -ArgumentList @('/K', $serverCommand) `
    -WorkingDirectory $WebRoot `
    -PassThru

$deadline = [DateTime]::UtcNow.AddSeconds($LaunchTimeoutSeconds)
$serverReady = $false
while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $response = Invoke-WebRequest -Uri $AppUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            $serverReady = $true
            break
        }
    }
    catch {
        # Vite is still starting.
    }
}

if (-not $serverReady) {
    Stop-ProcessTree -ProcessId $serverProcess.Id
    throw "The development server did not become ready within $LaunchTimeoutSeconds seconds. Review the npm output above."
}

if (-not $NoBrowser) {
    Start-Process $AppUrl
}

Write-Host "`nAIVision Traffic Counter is running at $AppUrl" -ForegroundColor Green
Write-Host 'The development server is in the new command window. Close that window or press Ctrl+C there to stop it.'
