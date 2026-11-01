#!/bin/sh
# docker/drill/clean-host-drill.sh
# Phase 5 acceptance drill (AGENT_PROMPT.md Phase 5, NFR-06, NFR-15): follows README §9 on a clean Linux host that
# has only Docker, git and curl, then proves a backup restores. Every step is echoed with its command.
#   1. clone → configure .env.production → docker compose up -d --build
#   2. create the first TD with `pnpm admin:create`; log in over HTTPS through Caddy; check security headers
#   3. use the API with the CSRF token; check the SSE stream passes through Caddy unbuffered
#   4. take a backup; change data after it; restore; verify the post-backup change is gone and the backed-up data is back
# Usage on the clean host: sh clean-host-drill.sh <git-repository-url-or-bundle> [branch]
# Uses DOMAIN=localhost (Caddy's local CA), so curl runs with -k. Exits non-zero on the first failed check.

set -eu

repository_source="${1:?usage: clean-host-drill.sh <repository> [branch]}"
branch_name="${2:-main}"
work_directory="${DRILL_WORK_DIRECTORY:-/drill/work}"
base_url="https://localhost"
compose="docker compose -f docker-compose.prod.yml --env-file .env.production"
cookie_jar="${work_directory}/cookies.txt"

step() { printf '\n=== %s\n' "$*"; }
run() { printf '$ %s\n' "$*"; sh -c "$*"; }
fail() { printf 'DRILL FAILED: %s\n' "$*" >&2; exit 1; }
random_secret() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
csrf_token() { awk '$6 == "uscc_csrf" { print $7 }' "${cookie_jar}"; }
api() {
  # api METHOD PATH JSON: authenticated call with Origin, CSRF token and a fresh Idempotency-Key.
  curl -sk -b "${cookie_jar}" -c "${cookie_jar}" -X "$1" "${base_url}$2" \
    -H "Origin: ${base_url}" -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $(csrf_token)" -H "Idempotency-Key: drill-$(random_secret)" \
    --data "$3" -w '\nHTTP %{http_code}\n'
}

step "1. Clone ${repository_source} (${branch_name})"
rm -rf "${work_directory}" && mkdir -p "${work_directory}"
run "git clone --branch '${branch_name}' '${repository_source}' '${work_directory}/uscc'"
cd "${work_directory}/uscc"

step "2. Configure .env.production (README §9 step 2)"
run "cp .env.production.example .env.production"
postgres_password="$(random_secret)"
sed -i "s|^DOMAIN=.*|DOMAIN=localhost|; s|^APP_URL=.*|APP_URL=${base_url}|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${postgres_password}|" .env.production
grep -v '^POSTGRES_PASSWORD' .env.production | grep -v '^#' | grep -v '^$'

step "3. Build and start the stack (README §9 step 3)"
run "${compose} up -d --build"
echo "Waiting for the app behind Caddy…"
attempt=0
until curl -sk -o /dev/null -w '%{http_code}' "${base_url}/login" | grep -q 200; do
  attempt=$((attempt + 1)); [ "${attempt}" -lt 90 ] || fail "app did not come up"; sleep 2
done
run "${compose} ps"

step "4. Create the first technical arbiter (README §9 step 4)"
admin_password="Drill-$(random_secret)"
run "${compose} run --rm -e ADMIN_USERNAME=td_admin -e ADMIN_PASSWORD='${admin_password}' tools pnpm admin:create"

step "5. Log in over HTTPS and check security headers"
login_response="$(curl -sk -c "${cookie_jar}" -D - -X POST "${base_url}/api/auth/login" -H "Origin: ${base_url}" -H "Content-Type: application/json" \
  --data "{\"username\":\"td_admin\",\"password\":\"${admin_password}\"}")"
echo "${login_response}" | grep -qi '^HTTP/[0-9.]* 200' || fail "login did not return 200"
echo "${login_response}" | grep -qi '^strict-transport-security:' || fail "HSTS header missing"
echo "${login_response}" | grep -qi 'set-cookie: uscc_session=.*httponly' || fail "session cookie is not HttpOnly"
echo "${login_response}" | grep -qi 'set-cookie: uscc_session=.*secure' || fail "session cookie is not Secure"
[ -n "$(csrf_token)" ] || fail "CSRF cookie missing"
echo "Login OK; HSTS present; session cookie HttpOnly+Secure; CSRF cookie set."
curl -s -o /dev/null -w 'Plain HTTP → %{http_code} %{redirect_url}\n' "http://localhost/login"

step "6. Use the API: CSRF enforced, account created"
missing_csrf_status="$(curl -sk -b "${cookie_jar}" -o /dev/null -w '%{http_code}' -X POST "${base_url}/api/users" -H "Origin: ${base_url}" \
  -H "Content-Type: application/json" -H "Idempotency-Key: drill-nocsrf" --data '{"username":"rec_nocsrf","password":"Recorder-Pass-1","role":"RECORDER"}')"
[ "${missing_csrf_status}" = "403" ] || fail "mutation without CSRF token returned ${missing_csrf_status}, expected 403"
echo "Mutation without CSRF token → 403 as expected."
api POST /api/users '{"username":"recorder_before_backup","password":"Recorder-Pass-1","role":"RECORDER"}' | tail -1 | grep -q 'HTTP 201' || fail "could not create recorder"
tournament_response="$(api POST /api/tournaments '{"name":"Giải diễn tập","startDate":"2026-11-01","endDate":"2026-11-01","roundsCount":1,"timezone":"Asia/Ho_Chi_Minh"}')"
tournament_id="$(echo "${tournament_response}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
[ -n "${tournament_id}" ] || fail "could not create tournament: ${tournament_response}"
echo "Created recorder_before_backup and tournament ${tournament_id}."

step "7. Live updates stream through Caddy (SSE, unbuffered)"
sse_output="$(curl -sk -N -b "${cookie_jar}" --max-time 3 "${base_url}/api/tournaments/${tournament_id}/events" || true)"
echo "${sse_output}" | grep -q 'event: ready' || fail "SSE ready event not received through Caddy"
echo "SSE 'ready' event received within 3 s."

step "8. Back up (README §9 Backups)"
run "${compose} exec -T backup sh /backup-scripts/backup-database.sh"
dump_file="$(${compose} exec -T backup sh -c 'ls -1t /backups/db-*.dump | head -1' | tr -d '\r')"
uploads_file="$(${compose} exec -T backup sh -c 'ls -1t /backups/uploads-*.tar.gz | head -1' | tr -d '\r')"
echo "Latest backup: ${dump_file} ${uploads_file}"

step "9. Change data after the backup"
api POST /api/users '{"username":"recorder_after_backup","password":"Recorder-Pass-1","role":"RECORDER"}' | tail -1 | grep -q 'HTTP 201' || fail "could not create post-backup recorder"

step "10. Restore (README §9 Restore)"
run "${compose} stop app caddy"
run "${compose} run --rm -e CONFIRM_RESTORE=yes --entrypoint sh backup /backup-scripts/restore-database.sh '${dump_file}' '${uploads_file}'"
run "${compose} up -d"
attempt=0
until curl -sk -o /dev/null -w '%{http_code}' "${base_url}/login" | grep -q 200; do
  attempt=$((attempt + 1)); [ "${attempt}" -lt 60 ] || fail "app did not come back after restore"; sleep 2
done

step "11. Verify the restored data"
rm -f "${cookie_jar}"
curl -sk -c "${cookie_jar}" -o /dev/null -X POST "${base_url}/api/auth/login" -H "Origin: ${base_url}" -H "Content-Type: application/json" \
  --data "{\"username\":\"td_admin\",\"password\":\"${admin_password}\"}"
users_after_restore="$(curl -sk -b "${cookie_jar}" "${base_url}/api/users")"
echo "${users_after_restore}" | grep -q '"recorder_before_backup"' || fail "backed-up recorder missing after restore"
echo "${users_after_restore}" | grep -q '"recorder_after_backup"' && fail "post-backup recorder still present after restore"
curl -sk -b "${cookie_jar}" "${base_url}/api/tournaments/${tournament_id}" | grep -q '"Giải diễn tập"' || fail "tournament missing after restore"
append_only_check="$(${compose} exec -T postgres psql -U uscc -d uscc -tAc "SELECT count(*) FROM pg_trigger WHERE tgname = 'result_events_append_only'" | tr -d '\r ')"
[ "${append_only_check}" = "1" ] || fail "append-only trigger missing after restore"
echo "Restore verified: pre-backup data present, post-backup change gone, append-only trigger restored."

step "DRILL PASSED"
