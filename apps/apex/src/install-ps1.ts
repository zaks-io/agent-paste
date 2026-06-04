// Windows PowerShell installer served at https://agent-paste.sh/install.ps1.
// Run with: irm https://agent-paste.sh/install.ps1 | iex
//
// Parallel to install-sh.ts for the Windows .exe asset: downloads the binary,
// verifies it against SHA256SUMS, installs to %LOCALAPPDATA%\\agent-paste\\bin,
// and adds that dir to the user PATH if missing. Resolves "latest" via the
// releases/latest/download/ redirect (no GitHub API). Honors
// $env:AGENT_PASTE_VERSION and $env:AGENT_PASTE_INSTALL_DIR.

export const INSTALL_PS1 = `# agent-paste CLI installer. https://agent-paste.sh/install.ps1
#requires -Version 5
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'zaks-io/agent-paste'
$Bin = 'agent-paste'
$Version = if ($env:AGENT_PASTE_VERSION) { $env:AGENT_PASTE_VERSION } else { 'latest' }
$InstallDir = if ($env:AGENT_PASTE_INSTALL_DIR) { $env:AGENT_PASTE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'agent-paste\\bin' }

function Fail($msg) { Write-Error "agent-paste: $msg"; exit 1 }

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64') {
  Fail "no prebuilt Windows binary for $arch. See https://github.com/$Repo/releases"
}
# Only agent-paste-windows-x64.exe is published today.
$asset = "$Bin-windows-x64.exe"

if ($Version -eq 'latest') {
  $base = "https://github.com/$Repo/releases/latest/download"
} else {
  $base = "https://github.com/$Repo/releases/download/$Version"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $exePath = Join-Path $tmp $asset
  $sumsPath = Join-Path $tmp 'SHA256SUMS'

  Write-Host "Downloading $asset ($Version)..."
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $exePath -UseBasicParsing
  Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing

  Write-Host "Verifying checksum..."
  $want = $null
  foreach ($raw in Get-Content $sumsPath) {
    # SHA256SUMS lines: "<hash>  <file>" or "<hash> *<file>".
    $line = $raw -replace '\\*', ' '
    $parts = $line -split '\\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $asset) { $want = $parts[0].Trim(); break }
  }
  if (-not $want) { Fail "no checksum for $asset in SHA256SUMS" }

  $got = (Get-FileHash -Algorithm SHA256 -Path $exePath).Hash.ToLowerInvariant()
  if ($want.ToLowerInvariant() -ne $got) {
    Fail "checksum mismatch for $asset\`n  expected $want\`n  got      $got"
  }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $dest = Join-Path $InstallDir "$Bin.exe"
  Move-Item -Force -Path $exePath -Destination $dest

  Write-Host "Installed $Bin to $dest"

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  $onPath = ($userPath -split ';') -contains $InstallDir
  if (-not $onPath) {
    $newPath = if ($userPath.TrimEnd(';')) { "$($userPath.TrimEnd(';'));$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host ""
    Write-Host "Added $InstallDir to your user PATH. Restart your terminal to use '$Bin'."
  }

  Write-Host ""
  Write-Host "Verify with: $Bin --version"
}
finally {
  Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
}
`;
