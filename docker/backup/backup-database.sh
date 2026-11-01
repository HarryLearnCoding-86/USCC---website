#!/bin/sh
# docker/backup/backup-database.sh
# One backup run (BR-14, NFR-06): a custom-format pg_dump of the database plus a tar.gz of uploaded files
# (logos, pairing workbooks), both timestamped in UTC. The dump is verified with pg_restore --list before older
# backups are pruned, so a broken dump never causes good backups to be deleted.
# Environment: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_DIRECTORY UPLOADS_DIRECTORY BACKUP_RETENTION_DAYS.
# Copy BACKUP_DIRECTORY off the server regularly (SRS §9: backups on storage separate from the server).

set -eu

backup_directory="${BACKUP_DIRECTORY:-/backups}"
uploads_directory="${UPLOADS_DIRECTORY:-/uploads}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="${backup_directory}/db-${timestamp}.dump"
uploads_archive_path="${backup_directory}/uploads-${timestamp}.tar.gz"

mkdir -p "${backup_directory}"

# Write to a temporary name first so a half-written dump is never mistaken for a complete one.
pg_dump --format=custom --no-owner --file="${dump_path}.partial"
pg_restore --list "${dump_path}.partial" > /dev/null
mv "${dump_path}.partial" "${dump_path}"

if [ -d "${uploads_directory}" ]; then
  tar -czf "${uploads_archive_path}.partial" -C "${uploads_directory}" .
  mv "${uploads_archive_path}.partial" "${uploads_archive_path}"
fi

# Prune only after this run succeeded.
find "${backup_directory}" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime "+${retention_days}" -delete
find "${backup_directory}" -maxdepth 1 -type f -name '*.partial' -mmin +60 -delete

echo "{\"event\":\"backup.completed\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"dump\":\"${dump_path}\",\"bytes\":$(wc -c < "${dump_path}")}"
