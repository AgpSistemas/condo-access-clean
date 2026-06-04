$ErrorActionPreference = "Stop"

if (-not $env:RENDER_API_KEY) {
  throw "Defina RENDER_API_KEY antes de rodar este script."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiEnvPath = Join-Path $repoRoot "apps\api\.env.local"

function Read-EnvFile($path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $path)) {
    return $values
  }

  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $separator = $line.IndexOf("=")
    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if ($key) {
      $values[$key] = $value
    }
  }

  return $values
}

function Invoke-RenderApi($method, $path, $body = $null) {
  $headers = @{
    Authorization = "Bearer $env:RENDER_API_KEY"
    Accept = "application/json"
  }

  if ($body -eq $null) {
    return Invoke-RestMethod -Method $method -Uri "https://api.render.com/v1$path" -Headers $headers
  }

  return Invoke-RestMethod `
    -Method $method `
    -Uri "https://api.render.com/v1$path" `
    -Headers $headers `
    -ContentType "application/json" `
    -Body ($body | ConvertTo-Json -Depth 20)
}

$localEnv = Read-EnvFile $apiEnvPath
$required = @("DATABASE_URL", "PGSSLMODE", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SIP_DEFAULT_PASSWORD")
foreach ($key in $required) {
  if (-not $localEnv.ContainsKey($key)) {
    throw "Variavel ausente em apps/api/.env.local: $key"
  }
}

$databaseUrl = $env:RENDER_DATABASE_URL
if (-not $databaseUrl) {
  $databaseUrl = $localEnv["DATABASE_URL"]
}

# Render free instances do not reach the Supabase direct IPv6 host. Use the Supabase
# Session Pooler for this project unless RENDER_DATABASE_URL was provided explicitly.
if (-not $env:RENDER_DATABASE_URL -and $databaseUrl -like "*db.ffraqsytpoisvsfdisbc.supabase.co*") {
  $parsedDatabaseUrl = [Uri]$databaseUrl
  $password = $parsedDatabaseUrl.UserInfo.Substring($parsedDatabaseUrl.UserInfo.IndexOf(":") + 1)
  $databaseUrl = "postgresql://postgres.ffraqsytpoisvsfdisbc:$password@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
}

$owners = Invoke-RenderApi "GET" "/owners?limit=20"
if (-not $owners -or -not $owners[0].owner.id) {
  throw "Nao foi possivel localizar workspace do Render."
}

$owner = $owners[0].owner
$existingServices = Invoke-RenderApi "GET" "/services?ownerId=$($owner.id)&limit=100"
$existing = @($existingServices) | Where-Object { $_.service.name -eq "condo-access-clean" -or $_.service.name -eq "condo-access-api" } | Select-Object -First 1

if ($existing) {
  [pscustomobject]@{
    ok = $true
    reused = $true
    owner = $owner.name
    serviceId = $existing.service.id
    name = $existing.service.name
    dashboardUrl = $existing.service.dashboardUrl
  } | ConvertTo-Json -Compress
  exit 0
}

$envVars = @(
  @{ key = "NODE_ENV"; value = "production" },
  @{ key = "DATABASE_URL"; value = $databaseUrl },
  @{ key = "PGSSLMODE"; value = $localEnv["PGSSLMODE"] },
  @{ key = "SUPABASE_URL"; value = $localEnv["SUPABASE_URL"] },
  @{ key = "SUPABASE_PUBLISHABLE_KEY"; value = $localEnv["SUPABASE_PUBLISHABLE_KEY"] },
  @{ key = "EXPOSE_CAMERA_RTSP"; value = "false" },
  @{ key = "SIP_DOMAIN"; value = "granportalresidency.ddns.net" },
  @{ key = "ASTERISK_PUBLIC_HOST"; value = "granportalresidency.ddns.net" },
  @{ key = "ASTERISK_WS_URL"; value = "wss://granportalresidency.ddns.net:8089/ws" },
  @{ key = "SIP_DEFAULT_PASSWORD"; value = $localEnv["SIP_DEFAULT_PASSWORD"] }
)

$body = @{
  type = "web_service"
  name = "condo-access-clean"
  ownerId = $owner.id
  repo = "https://github.com/AgpSistemas/condo-access-clean"
  branch = "main"
  autoDeploy = "yes"
  envVars = $envVars
  serviceDetails = @{
    runtime = "docker"
    plan = "free"
    region = "oregon"
    healthCheckPath = "/health"
    numInstances = 1
    envSpecificDetails = @{
      dockerContext = "."
      dockerfilePath = "./Dockerfile"
    }
  }
}

$created = Invoke-RenderApi "POST" "/services" $body

[pscustomobject]@{
  ok = $true
  reused = $false
  owner = $owner.name
  serviceId = $created.service.id
  name = $created.service.name
  dashboardUrl = $created.service.dashboardUrl
} | ConvertTo-Json -Compress
