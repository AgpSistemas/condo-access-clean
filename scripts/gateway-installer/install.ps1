param(
  [string]$ApiUrl = "https://api-production-441f.up.railway.app/api",
  [string]$TenantId = "",
  [string]$ActivationCode = ""
)

$ErrorActionPreference = "Stop"

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

if (-not $TenantId) { $TenantId = Read-Host "ID do condominio" }
if (-not $ActivationCode) { $ActivationCode = Read-Host "Codigo de ativacao" }
if (-not $TenantId -or -not $ActivationCode) { throw "ID do condominio e codigo de ativacao sao obrigatorios." }

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "CondoAccessGateway.exe") -Destination (Join-Path $InstallDir "CondoAccessGateway.exe") -Force

@{
  apiUrl = $ApiUrl.TrimEnd("/")
  tenantId = $TenantId.Trim()
  activationCode = $ActivationCode.Trim()
  gatewayId = $env:COMPUTERNAME
  pollMs = 3000
  localPort = 4040
} | ConvertTo-Json | Set-Content -Path (Join-Path $DataDir "config.json") -Encoding UTF8

$Action = New-ScheduledTaskAction -Execute (Join-Path $InstallDir "CondoAccessGateway.exe")
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Condo Access Gateway instalado e iniciado." -ForegroundColor Green
Write-Host "Configuracao: $DataDir\config.json"
Write-Host "Saude local: http://127.0.0.1:4040/health"
Read-Host "Pressione ENTER para fechar"
