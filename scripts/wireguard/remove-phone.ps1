# Cut off a lost or retired phone immediately.
# Usage (Administrator PowerShell): .\remove-phone.ps1 -Name <name>
param([Parameter(Mandatory = $true)][string]$Name)
. (Join-Path $PSScriptRoot "common.ps1")
Assert-Admin
Assert-WireGuard

$pubFile = Join-Path $PhonesDir "$Name.pub"
if (-not (Test-Path $pubFile)) {
    $known = Get-ChildItem $PhonesDir -Filter *.pub | ForEach-Object { $_.BaseName }
    throw "No phone named '$Name'. Enrolled phones: $($known -join ', ')"
}

$pub = (Get-Content $pubFile -Raw).Trim()
Invoke-Wg @("set", $Tunnel, "peer", $pub, "remove") | Out-Null

$pattern = "(?s)\r?\n?# BEGIN phone $([regex]::Escape($Name))\r?\n.*?# END phone $([regex]::Escape($Name))\r?\n?"
$text = [regex]::Replace((Get-Content $Conf -Raw), $pattern, "")
Write-Private $Conf $text
Remove-Item $pubFile -Force

Write-Host "Phone $Name can no longer reach the box."
Write-Host "Also disable that person's ledger account in Settings > Users if they should lose access."
