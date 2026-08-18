#!/bin/bash
#
# Docker Cleanup Script for Production
# Automatically removes unused images, containers, and build cache
# Run via cron or as part of deployment pipeline

set -e

echo "=== Docker Cleanup Started $(date) ==="

# Remove stopped containers older than 24h
echo "Cleaning up stopped containers..."
docker container prune -f --filter "until=24h" || true

# Remove unused images (not attached to running containers)
echo "Cleaning up unused images..."
docker image prune -a -f --filter "until=24h" || true

# Remove unused networks
echo "Cleaning up unused networks..."
docker network prune -f || true

# Remove unused volumes (BE CAREFUL - only if no important data)
echo "Cleaning up unused volumes..."
docker volume prune -f --filter "label!=keep" || true

# Clean build cache but keep recent builds (last 7 days)
echo "Cleaning up build cache..."
docker builder prune -f --filter "until=168h" || true

# Show current usage after cleanup
echo "=== Disk usage after cleanup ==="
docker system df

echo "=== Docker Cleanup Completed $(date) ==="