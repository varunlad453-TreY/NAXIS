#!/bin/bash
REPO_DIR="/home/naksatra/Desktop/Network REsilient PLatform"
LOG_FILE="$REPO_DIR/scripts/pull.log"

cd "$REPO_DIR" || exit 1

BEFORE=$(git rev-parse HEAD)
git pull --ff-only origin master >> "$LOG_FILE" 2>&1
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') | NEW CHANGES PULLED" >> "$LOG_FILE"
    git log --oneline "$BEFORE..$AFTER" | sed 's/^/  /' >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') | up to date" >> "$LOG_FILE"
fi
