FROM node:20-alpine AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install && ls -la /app/node_modules/.bin/next

FROM node:20-alpine AS test
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
RUN ls -la /app/node_modules/.bin/next && echo "BIN_EXISTS" || echo "NO_BIN"
