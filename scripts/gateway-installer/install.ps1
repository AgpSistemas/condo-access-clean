param(
  [string]$InstallCode = ""
)

$ErrorActionPreference = "Stop"
$ApiUrl = "https://api-production-441f.up.railway.app/api"

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList $Arguments
  exit
}

$InstallDir = Join-Path $env:ProgramFiles "Condo Access Gateway"
$DataDir = Join-Path $env:ProgramData "CondoAccessGateway"
$TaskName = "CondoAccessGateway"

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
  Start-Sleep -Seconds 2
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "CondoAccessGateway.exe") -Destination (Join-Path $InstallDir "CondoAccessGateway.exe") -Force

@{
  apiUrl = $ApiUrl
  tenantId = $Setup.tenantId
  activationCode = $Setup.activationCode
  gatewayId = $env:COMPUTERNAME
  label = $Setup.label
  pollMs = $Setup.pollMs
  localPort = $Setup.localPort
} | ConvertTo-Json | Set-Content -Path (Join-Path $DataDir "config.json") -Encoding UTF8

$Action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir "CondoAccessGateway.exe")
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
