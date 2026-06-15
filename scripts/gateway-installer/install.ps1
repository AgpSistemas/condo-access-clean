param(
  [string]$InstallCode = ""
)

$ErrorActionPreference = "Stop"
$ApiUrl = "https://api-production-441f.up.railway.app/api"

trap {
  Write-Host ""
  Write-Host "Falha na instalacao do Condo Access Gateway." -ForegroundColor Red
  Write-Host ($_.Exception.Message) -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Confira se voce extraiu o ZIP antes de executar o run-install.cmd." -ForegroundColor Cyan
  Read-Host "Pressione ENTER para fechar"
  exit 1
}

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $Arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList $Arguments
  exit
}

$InstallDir = Join-Path $env:ProgramFiles "Condo Access Gateway"
$DataDir = Join-Path $env:ProgramData "CondoAccessGateway"
$TaskName = "CondoAccessGateway"
$InstalledExe = Join-Path $InstallDir "CondoAccessGateway.exe"

if (-not $InstallCode) { $InstallCode = Read-Host "Codigo de instalacao exibido no painel" }
$InstallCode = ($InstallCode -replace "[^a-zA-Z0-9]", "").ToUpper()
if (-not $InstallCode) { throw "O codigo de instalacao e obrigatorio." }

Write-Host "Buscando configuracao do condominio..." -ForegroundColor Cyan
$SetupBody = @{
  installCode = $InstallCode
  hostname = $env:COMPUTERNAME
} | ConvertTo-Json

try {
  $Setup = Invoke-RestMethod `
    -Uri "$ApiUrl/gateways/setup/claim" `
    -Method Post `
    -ContentType "application/json" `
    -Body $SetupBody
} catch {
  $Message = $_.ErrorDetails.Message
  if (-not $Message) { $Message = $_.Exception.Message }
  throw "Nao foi possivel validar o codigo de instalacao. $Message"
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  for ($Attempt = 0; $Attempt -lt 10; $Attempt += 1) {
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $Task -or $Task.State -ne "Running") { break }
    Start-Sleep -Seconds 1
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and
    [System.String]::Equals($_.ExecutablePath, $InstalledExe, [System.StringComparison]::OrdinalIgnoreCase)
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
$SourceExe = Join-Path $PSScriptRoot "CondoAccessGateway.exe"
if (-not (Test-Path -LiteralPath $SourceExe)) {
  throw "CondoAccessGateway.exe nao encontrado. Extraia todo o ZIP em uma pasta e execute o run-install.cmd dentro da pasta extraida."
}
Copy-Item -LiteralPath $SourceExe -Destination $InstalledExe -Force
$SourceHash = (Get-FileHash -LiteralPath $SourceExe -Algorithm SHA256).Hash
$InstalledHash = (Get-FileHash -LiteralPath $InstalledExe -Algorithm SHA256).Hash
if ($SourceHash -ne $InstalledHash) {
  throw "O executavel instalado nao corresponde a nova versao."
}

@{
  apiUrl = $ApiUrl
  tenantId = $Setup.tenantId
  activationCode = $Setup.activationCode
  gatewayId = $env:COMPUTERNAME
  label = $Setup.label
  pollMs = $Setup.pollMs
  localPort = $Setup.localPort
} | ConvertTo-Json | Set-Content -Path (Join-Path $DataDir "config.json") -Encoding UTF8

$Action = New-ScheduledTaskAction -Execute $InstalledExe
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Condo Access Gateway instalado e iniciado." -ForegroundColor Green
Write-Host "Condominio: $($Setup.tenantName)"
Write-Host "Instalacao: $($Setup.label)"
Write-Host "Configuracao: $DataDir\config.json"
Write-Host "Saude local: http://127.0.0.1:$($Setup.localPort)/health"
Read-Host "Pressione ENTER para fechar"
