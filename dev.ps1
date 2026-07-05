$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$env:API_HOST_PORT = "8001"
$env:POSTGRES_HOST_PORT = "5433"
$env:REDIS_HOST_PORT = "6380"
$env:WEB_HOST_PORT = "3001"

docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml up --build