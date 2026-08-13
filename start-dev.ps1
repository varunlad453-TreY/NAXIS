# Start backend (Docker) only, frontend natively — no naxis-web container
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml stop web 2>&1 | Out-Null
Write-Host "Starting backend services (Docker)..." -ForegroundColor Cyan
docker compose --env-file config/.env -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis worker api

Write-Host "Starting frontend (native)..." -ForegroundColor Cyan
Set-Location -LiteralPath "$repoRoot\frontend"
npm run dev


