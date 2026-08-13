# Start backend (Docker) only, frontend natively — no naxis-web container
docker compose -f docker-compose.yml -f docker-compose.dev.yml stop web 2>$null
Write-Host "Starting backend services (Docker)..." -ForegroundColor Cyan
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis worker api

Write-Host "Starting frontend (native)..." -ForegroundColor Cyan
Set-Location -LiteralPath "frontend"
Remove-Item -Recurse -Force .next 2>$null
npm run dev
