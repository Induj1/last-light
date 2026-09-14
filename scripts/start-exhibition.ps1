[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packagePath = Join-Path $projectRoot 'package.json'
$serverPath = Join-Path $projectRoot 'server/index.js'
if (!(Test-Path -LiteralPath $packagePath -PathType Leaf) -or !(Test-Path -LiteralPath $serverPath -PathType Leaf)) {
  throw 'Keep this launcher inside the LAST LIGHT scripts folder, together with the complete project.'
}
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'last-light') { throw 'This launcher must be run from the LAST LIGHT project.' }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (!$nodeCommand -or !$npmCommand) { throw 'Install Node.js 22 or newer (including npm), reopen PowerShell, and run this launcher again.' }

$eventPort = 3001
if ($env:PORT -and (![int]::TryParse($env:PORT, [ref]$eventPort) -or $eventPort -lt 1 -or $eventPort -gt 65535)) {
  throw 'PORT must be an integer between 1 and 65535, or unset for port 3001.'
}
$gameUrl = "http://127.0.0.1:$eventPort"
$browserJob = $null

Push-Location -LiteralPath $projectRoot
try {
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
    Write-Host 'First-time setup: installing npm dependencies. This step requires internet.' -ForegroundColor Yellow
    & $npmCommand.Source install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the npm output, then run the launcher again.' }
  }
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html') -PathType Leaf)) {
    Write-Host 'Preparing the local production display...' -ForegroundColor Cyan
    & $npmCommand.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed. Check the build output above.' }
  }

  # Do not stop or replace any existing process that owns the desired port.
  $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $eventPort)
  try { $portProbe.Start() }
  catch { throw "Cannot use port $eventPort. Stop the previous LAST LIGHT server with Ctrl+C, or choose another PORT. $($_.Exception.Message)" }
  finally { $portProbe.Stop() }

  Write-Host "LAST LIGHT: $gameUrl" -ForegroundColor Green
  Write-Host 'Keep this window open. Press Ctrl+C to stop the local server.'
  Write-Host 'After editing source files, run npm run build before using this launcher again.'
  if (!$NoBrowser) {
    # PowerShell's background job polls readiness without opening a helper window.
    # The game browser is intentionally interactive and appears only after startup.
    $browserJob = Start-Job -ArgumentList $gameUrl -ScriptBlock {
      param($url)
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
          $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1 -ErrorAction Stop
          if ($health.ok -and $health.name -eq 'LAST LIGHT') {
            Start-Process -FilePath $url
            return
          }
        } catch { }
        Start-Sleep -Milliseconds 500
      }
      Write-Output "Open $url in your browser once the server is ready."
    }
  }

  # Run Node in this terminal so diagnostics and Ctrl+C remain available.
  & $nodeCommand.Source $serverPath
  if ($LASTEXITCODE -ne 0) { throw "LAST LIGHT stopped with exit code $LASTEXITCODE. See the terminal output above." }
} finally {
  if ($browserJob) {
    if ($browserJob.State -eq 'Running') { Stop-Job -Job $browserJob }
    Receive-Job -Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
