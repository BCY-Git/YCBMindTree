[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{7,64}$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._-]+\.zip$')]
  [string]$ArchiveName
)

$ErrorActionPreference = 'Stop'

$root = 'C:\MindTree'
$incoming = Join-Path $root 'incoming'
$archive = Join-Path $incoming $ArchiveName
$stage = Join-Path $incoming "stage-$ReleaseId"
$releaseRoot = Join-Path $root 'releases'
$backup = Join-Path $releaseRoot "backup-$ReleaseId"
$server = Join-Path $root 'server'
$web = Join-Path $root 'web'

function Stop-MindTreeServer {
  $listener = Get-NetTCPConnection -LocalPort 18789 -State Listen -ErrorAction SilentlyContinue
  foreach ($entry in $listener) {
    Stop-Process -Id $entry.OwningProcess -Force
  }
}

function Start-MindTreeServer {
  Start-Process cmd.exe -ArgumentList '/c', 'start-mindtree.cmd' -WorkingDirectory $root -WindowStyle Hidden
}

function Wait-ForMindTreeHealth {
  for ($attempt = 1; $attempt -le 15; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:18789/healthz' -TimeoutSec 5
      if ($response.ok -eq $true) {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw 'MindTree health check did not succeed within 30 seconds.'
}

if (-not (Test-Path $archive)) {
  throw "Release archive was not found: $archive"
}

New-Item -ItemType Directory -Force $releaseRoot | Out-Null
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Expand-Archive -Path $archive -DestinationPath $stage -Force

$payload = $stage
$newWeb = Join-Path $payload 'web'
$newServer = Join-Path $payload 'server'

foreach ($requiredPath in @(
  (Join-Path $newWeb 'index.html'),
  (Join-Path $newServer 'dist\main.js'),
  (Join-Path $newServer 'package.json')
)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Release archive is incomplete: $requiredPath"
  }
}

try {
  $backupReady = $false
  Remove-Item $backup -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $backup | Out-Null
  Copy-Item $web (Join-Path $backup 'web') -Recurse -Force
  Copy-Item $server (Join-Path $backup 'server') -Recurse -Force
  $backupReady = $true

  Stop-MindTreeServer

  Remove-Item $web -Recurse -Force
  Copy-Item $newWeb $web -Recurse -Force

  Remove-Item (Join-Path $server 'dist') -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $newServer 'dist') (Join-Path $server 'dist') -Recurse -Force
  Copy-Item (Join-Path $newServer 'package.json') (Join-Path $server 'package.json') -Force

  Push-Location $server
  try {
    npm install --omit=dev --no-audit --no-fund
  } finally {
    Pop-Location
  }

  Start-MindTreeServer
  Wait-ForMindTreeHealth
} catch {
  $deploymentError = $_
  if (-not $backupReady) {
    throw "Deployment stopped before a complete backup was created: $deploymentError"
  }

  Write-Error "Deployment failed; restoring backup $backup"

  try {
    Stop-MindTreeServer
    Remove-Item $web -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $server -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $backup 'web') $web -Recurse -Force
    Copy-Item (Join-Path $backup 'server') $server -Recurse -Force
    Start-MindTreeServer
    Wait-ForMindTreeHealth
  } catch {
    Write-Error "Rollback also failed: $($_.Exception.Message)"
  }

  throw $deploymentError
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $archive -Force -ErrorAction SilentlyContinue
}

Write-Host "MindTree release $ReleaseId is healthy. Backup retained at $backup"
