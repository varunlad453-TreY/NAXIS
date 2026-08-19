# NAXIS Production Deployment Guide

## Automated Docker Cleanup

### The Problem
- Docker builds accumulate cache and images over time
- Each deployment creates new images but doesn't clean old ones
- Can consume 20+ GB of disk space quickly
- Manual cleanup isn't scalable for production

### The Solution
NAXIS now includes automated Docker cleanup:

#### 1. Automated Cleanup Service
```bash
# Starts production stack WITH automated cleanup
make prod-up
```

**What it does:**
- Runs cleanup every 24 hours automatically
- Removes containers older than 24h
- Removes unused images older than 24h  
- Cleans build cache older than 7 days
- Preserves active containers and recent builds

#### 2. Manual Cleanup (for maintenance)
```bash
# Run manual cleanup anytime
make docker-cleanup
```

#### 3. Production vs Development

**Development (current):**
```bash
make dev    # No cleanup, keeps all images for fast rebuilds
```

**Production:**
```bash
make prod-up    # Includes automated cleanup + resource limits
```

## Production Features

### Resource Management
- **API**: 512MB RAM, 0.5 CPU limit
- **Worker**: 1GB RAM, 1.0 CPU limit  
- **Frontend**: 1GB RAM, 0.5 CPU limit
- **Database**: 2GB RAM, 1.0 CPU limit

### Logging
- **Log rotation**: Max 10MB per file, keep 3 files
- **JSON format** for production log aggregation
- **Separate log files** per service

### Health Monitoring
- **Health checks** on all critical services
- **Automatic restart** on failure
- **Startup grace periods** for proper initialization

### Security
- **Loopback-only binding** for database (127.0.0.1)
- **Resource limits** prevent resource exhaustion
- **No privileged containers**

## Deployment Commands

```bash
# Production deployment
make prod-up

# Check status
docker compose ps

# View production logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Stop production
make prod-down

# Manual cleanup if needed
make docker-cleanup
```

## Monitoring Disk Usage

```bash
# Check Docker disk usage
docker system df

# Monitor cleanup logs
docker logs naxis-cleanup -f
```

## CI/CD Integration

Add to your deployment pipeline:

```bash
#!/bin/bash
# Deploy script with automated cleanup
git pull
make prod-down
make prod-up

# The cleanup service runs automatically
# No manual intervention needed
```

## Cron Alternative

If you prefer cron over the Docker service:

```bash
# Add to crontab: cleanup daily at 2 AM
0 2 * * * /path/to/naxis/scripts/docker-cleanup.sh >> /var/log/docker-cleanup.log 2>&1
```