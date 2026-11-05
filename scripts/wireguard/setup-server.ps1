# Turn this Windows PC into the office WireGuard server.
# Usage (Administrator PowerShell): .\setup-server.ps1 -Endpoint <office-public-ip-or-hostname> [-Port 51820]
param(
    [Parameter(Mandatory = $true)][string]$Endpoint,
    [int]$Port = 51820
)
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin

if (-not (Test-Path $Wg)) {
    Write-Host "Installing WireGuard for Windows..."
    winget install --id WireGuard.WireGuard -e --accept-source-agreements --accept-package-agreements
    if (-not (Test-Path $Wg)) { throw "WireGuard install did not finish. Install it from wireguard.com and re-run." }
}

New-Item -ItemType Directory -Force -Path $PhonesDir | Out-Null
Lock-Folder $BoxDir

if (Test-Path $Conf) {
    Write-Host "$Conf already exists; leaving keys alone."
    $serverPub = Get-Content (Join-Path $BoxDir "server.pub")
} else {
    $serverKey = Invoke-Wg @("genkey")
    $serverPub = Invoke-Wg @("pubkey") $serverKey
    Write-Private (Join-Path $BoxDir "server.pub") $serverPub
    Write-Private $Conf @"
# Ledger office box. Phones reach only 10.8.0.1; nothing is forwarded to the office LAN.
[Interface]
Address = 10.8.0.1/24
ListenPort = $Port
PrivateKey = $serverKey
"@
}
Write-Private (Join-Path $BoxDir "endpoint") "${Endpoint}:$Port"

try { & $WireGuardExe /uninstalltunnelservice $Tunnel; Start-Sleep -Seconds 2 } catch { }
& $WireGuardExe /installtunnelservice $Conf
Start-Sleep -Seconds 3

Get-NetFirewallRule -DisplayName "Ledger WireGuard" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "Ledger WireGuard" -Direction Inbound -Protocol UDP -LocalPort $Port -Action Allow | Out-Null
Get-NetFirewallRule -DisplayName "Ledger app (VPN and LAN)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "Ledger app (VPN and LAN)" -Direction Inbound -Protocol TCP -LocalPort 443, 80 `
    -RemoteAddress "10.8.0.0/24", "LocalSubnet" -Action Allow | Out-Null

Write-Host ""
Write-Host "WireGuard is running on UDP $Port."
Write-Host "On the office router, forward UDP $Port (and nothing else) to this PC."
Write-Host "Box public key: $serverPub"
Write-Host "Add a phone with: .\add-phone.ps1 -Name <name>"
