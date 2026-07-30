@echo off
docker compose run --rm web sh -c "ls -la /app/node_modules/.bin 2>&1 || echo 'no .bin dir'; echo ===; npm --version; echo ===; ls /app/node_modules/next/package.json 2>&1"
