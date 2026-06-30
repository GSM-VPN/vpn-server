param(
  [Parameter(Mandatory = $false)]
  [string]$TunnelName = $env:TUNNEL_NAME,

  [Parameter(Mandatory = $false)]
  [string]$InternalUdpPort = $env:INTERNAL_UDP_PORT,

  [Parameter(Mandatory = $false)]
  [string]$ServerAddress = $(if ($env:SERVER_ADDRESS) { $env:SERVER_ADDRESS } else { "10.10.0.1/24" }),

  [Parameter(Mandatory = $false)]
  [string]$PeerNetwork = $env:PEER_NETWORK,

  [Parameter(Mandatory = $false)]
  [string]$WireGuardExePath = "",

  [Parameter(Mandatory = $false)]
  [string]$ServerPrivateKey = $env:SERVER_PRIVATE_KEY,

  [Parameter(Mandatory = $false)]
  [string]$ServerPrivateKeyFile = $(if ($env:SERVER_PRIVATE_KEY_FILE) { $env:SERVER_PRIVATE_KEY_FILE } else { Join-Path $env:ProgramData "GSM-VPN\$($env:TUNNEL_NAME).key" }),

  [Parameter(Mandatory = $false)]
  [switch]$InstallManagerService,

  [Parameter(Mandatory = $false)]
  [switch]$StartTunnel
)

$ErrorActionPreference = "Stop"

function Resolve-WireGuardExe {
  param([string]$ProvidedPath)

  if ($ProvidedPath -and (Test-Path $ProvidedPath)) {
    return (Resolve-Path $ProvidedPath).Path
  }

  $command = Get-Command "wireguard" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $defaultPath = Join-Path $env:ProgramFiles "WireGuard\wireguard.exe"
  if (Test-Path $defaultPath) {
    return $defaultPath
  }

  return $null
}

function Install-WireGuardIfMissing {
  param([string]$CurrentExePath)

  if ($CurrentExePath) {
    return $CurrentExePath
  }

  $installerUrl = "https://download.wireguard.com/windows-client/wireguard-installer.exe"
  $installerPath = Join-Path $env:TEMP "wireguard-installer.exe"
  Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath
  Start-Process -FilePath $installerPath -Wait

  $resolved = Resolve-WireGuardExe -ProvidedPath ""
  if (-not $resolved) {
    throw "WireGuard was not found after installation."
  }

  return $resolved
}

function New-WireGuardConfig {
  param(
    [string]$TunnelName,
    [string]$InternalUdpPort,
    [string]$ServerAddress,
    [string]$ServerPrivateKey
  )

  if (-not $ServerPrivateKey) {
    throw "ServerPrivateKey is required to generate the tunnel config."
  }

  $configDir = Join-Path $env:ProgramFiles "WireGuard\Data\Configurations"
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null

  $configPath = Join-Path $configDir "$TunnelName.conf"
  $content = @"
[Interface]
PrivateKey = $ServerPrivateKey
Address = $ServerAddress
ListenPort = $InternalUdpPort
"@
  Set-Content -Path $configPath -Value $content -Encoding ASCII
  return $configPath
}

$wireguardExe = Install-WireGuardIfMissing -CurrentExePath (Resolve-WireGuardExe -ProvidedPath $WireGuardExePath)

New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters" -Name "IPEnableRouter" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters" -Name "DisabledComponents" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue | Out-Null
netsh interface ipv4 set global forwarding=enabled | Out-Null
netsh interface ipv6 set global forwarding=enabled | Out-Null

if ($PeerNetwork) {
  try {
    $existingNat = Get-NetNat -Name $TunnelName -ErrorAction SilentlyContinue
    if (-not $existingNat) {
      New-NetNat -Name $TunnelName -InternalIPInterfaceAddressPrefix $PeerNetwork | Out-Null
    }
  } catch {
    Write-Warning "Could not create NAT rule automatically. You may need to configure NAT manually."
  }
}

if ($InstallManagerService) {
  Start-Process -FilePath $wireguardExe -ArgumentList "/installmanagerservice" -Wait
}

$keyDir = Split-Path -Parent $ServerPrivateKeyFile
if (-not (Test-Path $keyDir)) {
  New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
}

if (-not $ServerPrivateKey) {
  if (Test-Path $ServerPrivateKeyFile) {
    $ServerPrivateKey = (Get-Content -Path $ServerPrivateKeyFile -Raw).Trim()
  } else {
    $ServerPrivateKey = (node -e "const { generateKeyPairSync } = require('node:crypto'); const pair = generateKeyPairSync('x25519', { publicKeyEncoding: { format: 'der', type: 'spki' }, privateKeyEncoding: { format: 'der', type: 'pkcs8' } }); process.stdout.write(Buffer.from(pair.privateKey).subarray(-32).toString('base64'));")
    Set-Content -Path $ServerPrivateKeyFile -Value $ServerPrivateKey -Encoding ASCII
  }
}

if (-not $ServerPrivateKey) {
  throw "ServerPrivateKey could not be determined."
}

$configPath = New-WireGuardConfig `
  -TunnelName $TunnelName `
  -InternalUdpPort $InternalUdpPort `
  -ServerAddress $ServerAddress `
  -ServerPrivateKey $ServerPrivateKey

Start-Process -FilePath $wireguardExe -ArgumentList "/installtunnelservice `"$configPath`"" -Wait

if ($StartTunnel) {
  Start-Service -Name "WireGuardTunnel`$$TunnelName" -ErrorAction SilentlyContinue
}

Write-Host "WireGuard prepared: $configPath"
