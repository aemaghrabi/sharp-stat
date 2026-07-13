#requires -Version 5.1
<#
Builds a self-contained win-x64 release of Potentiostat.Web and packages it into a
Windows installer via Inno Setup. Requires the .NET 8 SDK and Inno Setup 6 (ISCC.exe)
to be installed; the .NET runtime itself is bundled into the output, so end users of
the resulting installer need neither.

Usage:
  scripts/publish-release.ps1 -Version 1.0.0
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webProject = Join-Path $repoRoot "src\Potentiostat.Web\Potentiostat.Web.csproj"
$publishDir = Join-Path $repoRoot "publish\win-x64"
$releaseDir = Join-Path $repoRoot "release"
$issScript = Join-Path $repoRoot "installer\PotentiostatWeb.iss"

Write-Host "== Publishing Potentiostat.Web $Version (win-x64, self-contained) ==" -ForegroundColor Cyan

if (Test-Path $publishDir) {
    Remove-Item -Recurse -Force $publishDir
}

dotnet publish $webProject `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishProfile=win-x64-selfcontained `
    -p:Version=$Version `
    -o $publishDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $publishDir "Potentiostat.Web.exe"
$wwwrootPath = Join-Path $publishDir "wwwroot"
$appsettingsPath = Join-Path $publishDir "appsettings.json"
foreach ($required in @($exePath, $wwwrootPath, $appsettingsPath)) {
    if (-not (Test-Path $required)) {
        throw "Publish output is missing expected item: $required"
    }
}
$exeSizeMb = [Math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host "Publish OK: $exePath ($exeSizeMb MB, self-contained)" -ForegroundColor Green

Write-Host "== Locating Inno Setup compiler (ISCC.exe) ==" -ForegroundColor Cyan
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
    $candidates = @(
        "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($found) {
        $iscc = Get-Item $found
    }
}
if (-not $iscc) {
    throw "ISCC.exe (Inno Setup 6 compiler) not found. Install Inno Setup 6 from jrsoftware.org and re-run."
}

if (-not (Test-Path $releaseDir)) {
    New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

Write-Host "== Building installer ==" -ForegroundColor Cyan
& $iscc.Path "/DMyAppVersion=$Version" "/DPublishDir=$publishDir" $issScript
if ($LASTEXITCODE -ne 0) {
    throw "ISCC.exe failed with exit code $LASTEXITCODE"
}

$installerPath = Join-Path $releaseDir "PotentiostatConsole-Setup-$Version.exe"
if (-not (Test-Path $installerPath)) {
    throw "Expected installer not found at $installerPath"
}
$installerSizeMb = [Math]::Round((Get-Item $installerPath).Length / 1MB, 1)

Write-Host ""
Write-Host "== Done ==" -ForegroundColor Cyan
Write-Host "Installer: $installerPath ($installerSizeMb MB)" -ForegroundColor Green
