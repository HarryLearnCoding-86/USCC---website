#!/bin/sh
# docker/backup/restore-database.sh
# Restores a backup made by backup-database.sh (BR-14, NFR-06: recovery time ≤ 30 minutes). DESTRUCTIVE: it
# replaces the whole database (and, if an uploads archive is given, the uploaded files). Stop the app first, and set
# CONFIRM_RESTORE=yes to proceed. Usage (README §9 "Restore"):
#   docker compose -f docker-compose.prod.yml stop app caddy
#   docker compose -f docker-compose.prod.yml run --rm -e CONFIRM_RESTORE=yes --entrypoint sh backup \
#     /backup-scripts/restore-database.sh /backups/db-YYYYMMDDTHHMMSSZ.dump /backups/uploads-YYYYMMDDTHHMMSSZ.tar.gz
#   docker compose -f docker-compose.prod.yml up -d
# Environment: PGHOST PGUSER PGPASSWORD PGDATABASE UPLOADS_DIRECTORY.

set -eu

dump_path="${1:?usage: restore-database.sh <db-…dump> [uploads-…tar.gz]}"
uploads_archive_path="${2:-}"
uploads_directory="${UPLOADS_DIRECTORY:-/uploads}"
database_name="${PGDATABASE:?PGDATABASE must be set}"

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore: this replaces database '${database_name}'. Set CONFIRM_RESTORE=yes to proceed." >&2
  exit 1
fi

# Check the dump is readable before anything is dropped.
pg_restore --list "${dump_path}" > /dev/null

echo "Restoring ${dump_path} into database '${database_name}' on ${PGHOST:-localhost}…"
# Connect to the maintenance database to recreate the target from scratch: a clean database avoids leftover
# objects, and the append-only trigger on result_events is restored together with the data.
psql --dbname=postgres --set=ON_ERROR_STOP=1 \
  --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database_name}' AND pid <> pg_backend_pid();" \
  --command="DROP DATABASE IF EXISTS \"${database_name}\";" \
  --command="CREATE DATABASE \"${database_name}\";"
pg_restore --no-owner --exit-on-error --dbname="${database_name}" "${dump_path}"

if [ -n "${uploads_archive_path}" ]; then
  echo "Restoring uploaded files from ${uploads_archive_path}…"
  find "${uploads_directory}" -mindepth 1 -delete
  tar -xzf "${uploads_archive_path}" -C "${uploads_directory}"
fi

echo "Restore complete. Start the stack again: docker compose -f docker-compose.prod.yml up -d"
