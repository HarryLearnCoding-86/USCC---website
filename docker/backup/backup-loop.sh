#!/bin/sh
# docker/backup/backup-loop.sh
# Entry point of the `backup` service: runs backup-database.sh every BACKUP_INTERVAL_MINUTES (default 15, as
# SRS §9 requires during a tournament day; NFR-06 recovery point ≤ 15 minutes). A failed run is logged and
# retried at the next interval instead of stopping the service. A host-cron alternative is in README §9.

set -u

interval_minutes="${BACKUP_INTERVAL_MINUTES:-15}"
script_directory="$(dirname "$0")"

echo "{\"event\":\"backup.scheduler_started\",\"intervalMinutes\":${interval_minutes}}"
while true; do
  if ! sh "${script_directory}/backup-database.sh"; then
    echo "{\"event\":\"backup.failed\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" >&2
  fi
  sleep $((interval_minutes * 60))
done
