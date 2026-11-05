# Enroll one phone. Prints a QR code to scan in the WireGuard app.
# The phone's private key is shown once and is not kept on the box.
# Usage (Administrator PowerShell, from the repo folder): .\scripts\wireguard\add-phone.ps1 -Name <name>
param([Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{1,32}$')][string]$Name)
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
Assert-WireGuard

$pubFile = Join-Path $PhonesDir "$Name.pub"
if (Test-Path $pubFile) { throw "A phone named $Name already exists. Remove it first." }

$confText = Get-Content $Conf -Raw
$n = 2
while ($confText -match "AllowedIPs = 10\.8\.0\.$n/32") {
    $n++
    if ($n -gt 254) { throw "No free addresses left." }
}
$addr = "10.8.0.$n"

$priv = Invoke-Wg @("genkey")
$pub = Invoke-Wg @("pubkey") $priv
$psk = Invoke-Wg @("genpsk")
Write-Private $pubFile $pub

Add-Content -Path $Conf -Encoding ascii -Value @"

# BEGIN phone $Name
[Peer]
PublicKey = $pub
PresharedKey = $psk
AllowedIPs = $addr/32
# END phone $Name
"@

$pskFile = [IO.Path]::GetTempFileName()
try {
    Write-Private $pskFile $psk
    Invoke-Wg @("set", $Tunnel, "peer", $pub, "preshared-key", $pskFile, "allowed-ips", "$addr/32") | Out-Null
} finally {
    Remove-Item $pskFile -Force
}

$serverPub = Get-Content (Join-Path $BoxDir "server.pub")
$endpoint = Get-Content (Join-Path $BoxDir "endpoint")
$client = @"
[Interface]
PrivateKey = $priv
Address = $addr/32

[Peer]
PublicKey = $serverPub
PresharedKey = $psk
Endpoint = $endpoint
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
"@

Write-Host "Phone $Name gets $addr. Scan this in the WireGuard app (Add tunnel > Scan from QR code):"
Write-Host ""
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $repoRoot
try {
    $client | docker compose exec -T app node apps/api/dist/box-cli.js qr
    if ($LASTEXITCODE -ne 0) { throw "qr failed" }
} catch {
    $file = Join-Path $env:USERPROFILE "Desktop\$Name.conf"
    Write-Private $file $client
    Write-Host "Could not draw the QR code. Saved $file instead: send it to the phone, import it in WireGuard, then delete it."
} finally {
    Pop-Location
}
Write-Host ""
Write-Host "Then open https://10.8.0.1 on the phone."
