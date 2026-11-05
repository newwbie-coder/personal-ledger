$ErrorActionPreference = "Stop"

$WgHome = Join-Path $env:ProgramFiles "WireGuard"
$Wg = Join-Path $WgHome "wg.exe"
$WireGuardExe = Join-Path $WgHome "wireguard.exe"
$BoxDir = Join-Path $env:ProgramData "LedgerBox\wireguard"
$Conf = Join-Path $BoxDir "ledger.conf"
$PhonesDir = Join-Path $BoxDir "phones"
$Tunnel = "ledger"

function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this from an Administrator PowerShell."
    }
}

function Assert-WireGuard {
    if (-not (Test-Path $Wg)) {
        throw "WireGuard for Windows is not installed. Run setup-server.ps1 first."
    }
}

function Invoke-Wg([string[]]$WgArgs, [string]$InputText) {
    if ($PSBoundParameters.ContainsKey("InputText")) {
        $out = $InputText | & $Wg @WgArgs
    } else {
        $out = & $Wg @WgArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "wg $($WgArgs -join ' ') failed" }
    return ($out | Out-String).Trim()
}

function Write-Private([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Lock-Folder([string]$Path) {
    & icacls $Path /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
}
