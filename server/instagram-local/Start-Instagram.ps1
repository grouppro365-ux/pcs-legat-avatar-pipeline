$ErrorActionPreference = 'Stop'
$pcsPython = Join-Path $env:LOCALAPPDATA 'PCS\instagram-venv\Scripts\pythonw.exe'
if (-not (Test-Path -LiteralPath $pcsPython)) {
    throw 'PCS Instagram runtime is not installed. See README.md.'
}
$pcsWindow = Join-Path $PSScriptRoot 'login_window.py'
Start-Process -FilePath $pcsPython -ArgumentList ('"' + $pcsWindow + '"') -WindowStyle Hidden
