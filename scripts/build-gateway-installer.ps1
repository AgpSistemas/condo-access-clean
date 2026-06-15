$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$GatewayRoot = Join-Path $Root "apps\gateway-win"
$Stage = Join-Path $Root ".gateway-installer-stage"
$Downloads = Join-Path $Root "apps\api\public\downloads"
$Exe = Join-Path $Stage "CondoAccessGateway.exe"
$Installer = Join-Path $Downloads "CondoAccessGateway-Setup.exe"
$ZipPackage = Join-Path $Downloads "CondoAccessGateway-0.4.0.zip"
$StagedInstaller = Join-Path $Stage "CondoAccessGateway-Setup.exe"
$SeaBlob = Join-Path $Stage "gateway-sea.blob"
$SeaConfig = Join-Path $Stage "sea-config.json"
$GatewayBundle = Join-Path $Stage "gateway-bundle.cjs"

if (-not $Stage.StartsWith("$Root\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretorio temporario fora do projeto: $Stage"
}
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage, $Downloads | Out-Null
if (Test-Path -LiteralPath $Installer) { Remove-Item -LiteralPath $Installer -Force }
if (Test-Path -LiteralPath $ZipPackage) { Remove-Item -LiteralPath $ZipPackage -Force }
if (Test-Path -LiteralPath $StagedInstaller) { Remove-Item -LiteralPath $StagedInstaller -Force }

npx.cmd --no-install esbuild (Join-Path $GatewayRoot "src\gateway.cjs") --bundle --platform=node --format=cjs --outfile=$GatewayBundle
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $GatewayBundle)) {
  throw "Nao foi possivel empacotar os modulos do Gateway."
}

@{
  main = $GatewayBundle
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
if errorlevel 1 (
  echo.
  echo A instalacao falhou. Veja a mensagem acima.
  pause
)
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
TargetName="$StagedInstaller"
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
if ($env:BUILD_GATEWAY_SFX -eq "true") {
  & "$env:WINDIR\System32\iexpress.exe" /N $SedPath
  $Deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path -LiteralPath $StagedInstaller) -and (Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 3
  }
}
$PackageFiles = @(
  (Join-Path $Stage "CondoAccessGateway.exe"),
  (Join-Path $Stage "install.ps1"),
  (Join-Path $Stage "run-install.cmd")
)
Compress-Archive -LiteralPath $PackageFiles -DestinationPath $ZipPackage -Force
Write-Host "Pacote ZIP gerado: $ZipPackage" -ForegroundColor Green

if (Test-Path -LiteralPath $StagedInstaller) {
  Copy-Item -LiteralPath $StagedInstaller -Destination $Installer -Force
  Write-Host "Instalador gerado: $Installer" -ForegroundColor Green
} else {
  Write-Warning "Setup.exe nao gerado nesta execucao; use o ZIP publicado com run-install.cmd."
}
