@echo off
setlocal EnableExtensions

cd /d "%~dp0"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceMetric | Select-Object -First 1 -ExpandProperty IPAddress); if (-not $ip) { $ip='localhost' }; Write-Output $ip"`) do set "LOCAL_IP=%%I"

set "API_PORT=3333"
set "WEB_PORT=3100"
set "API_URL=http://%LOCAL_IP%:%API_PORT%"
set "WEB_URL=http://%LOCAL_IP%:%WEB_PORT%"

if not exist "logs" mkdir "logs"
if not exist "data" mkdir "data"

echo.
echo Condo Access - desenvolvimento em rede local
echo API: %API_URL%
echo WEB: %WEB_URL%
echo.

start "Condo Access API %API_PORT%" /D "%~dp0" cmd /k "set PORT=%API_PORT%&& set API_PORT=%API_PORT%&& set API_HOST=0.0.0.0&& set DATA_FILE=%~dp0data\condo-access-state.json&& set PUBLIC_HOST=%LOCAL_IP%&& set SIP_DOMAIN=granportalresidency.ddns.net&& set ASTERISK_PUBLIC_HOST=granportalresidency.ddns.net&& set ASTERISK_WS_URL=wss://granportalresidency.ddns.net:8089/ws&& set SIP_DEFAULT_PASSWORD=CondoAccess@2026&& set EXPOSE_CAMERA_RTSP=false&& set MOBILE_CAMERA_STREAMS_FILE=C:\projetis\BKPAccess\condo-access-mobile-novo\src\cameras\mobileCameraStreams.ts&& npm.cmd run dev:api"

timeout /t 4 /nobreak >nul

start "Condo Access Web %WEB_PORT%" /D "%~dp0" cmd /k "set VITE_API_URL=%API_URL%&& set VITE_SYNC_INTERVAL_MS=2000&& npm.cmd run dev:web"

echo Processos iniciados em janelas separadas.
echo Abra no navegador: %WEB_URL%
echo Para parar, feche as janelas "Condo Access API" e "Condo Access Web".
echo.

endlocal
