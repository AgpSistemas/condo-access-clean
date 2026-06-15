$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$GatewayRoot = Join-Path $Root "apps\gateway-win"
$Stage = Join-Path $Root ".gateway-installer-stage"
$Downloads = Join-Path $Root "apps\api\public\downloads"
$Exe = Join-Path $Stage "CondoAccessGateway.exe"
$Installer = Join-Path $Downloads "CondoAccessGateway-Setup.exe"
$SeaBlob = Join-Path $Stage "gateway-sea.blob"
$SeaConfig = Join-Path $Stage "sea-config.json"

if (-not $Stage.StartsWith("$Root\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretorio temporario fora do projeto: $Stage"
}
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage, $Downloads | Out-Null
if (Test-Path -LiteralPath $Installer) { Remove-Item -LiteralPath $Installer -Force }

@{
  main = (Join-Path $GatewayRoot "src\gateway.cjs")
  output = $SeaBlob
  disableExperimentalSEAWarning = $true
  useSnapshot = $false
  useCodeCache = $true
} | ConvertTo-Json | Set-Content -Path $SeaConfig -Encoding UTF8

node --experimental-sea-config $SeaConfig
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $SeaBlob)) { throw "Nao foi possivel gerar o executavel SEA." }

$NodeExe = (Get-Command node.exe).Source
Copy-Item -LiteralPath $NodeExe -Destination $Exe -Force
npx.cmd --yes postject $Exe NODE_SEA_BLOB $SeaBlob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Exe)) { throw "Nao foi possivel injetar o Gateway no executavel." }

Copy-Item -LiteralPath (Join-Path $Root "scripts\gateway-installer\install.ps1") -Destination (Join-Path $Stage "install.ps1") -Force

$RunCmd = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
'@
Set-Content -Path (Join-Path $Stage "run-install.cmd") -Value $RunCmd -Encoding ASCII

$Sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName="$Installer"
FriendlyName=Condo Access Gateway
AppLaunched=run-install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[SourceFiles]
SourceFiles0="$Stage\"
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
[Strings]
FILE0="CondoAccessGateway.exe"
FILE1="install.ps1"
FILE2="run-install.cmd"
"@
$SedPath = Join-Path $Stage "installer.sed"
Set-Content -Path $SedPath -Value $Sed -Encoding ASCII
& "$env:WINDIR\System32\iexpress.exe" /N $SedPath

$Deadline = (Get-Date).AddMinutes(10)
while (-not (Test-Path -LiteralPath $Installer) -and (Get-Date) -lt $Deadline) {
  Start-Sleep -Seconds 3
}
if (-not (Test-Path -LiteralPath $Installer)) { throw "O instalador nao foi gerado." }
Write-Host "Instalador gerado: $Installer" -ForegroundColor Green
