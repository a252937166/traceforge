#!/usr/bin/env bash
set -Eeuo pipefail

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
api_current=/opt/traceforge
api_next=/opt/traceforge-next
api_previous="/opt/traceforge-prev-${stamp}"
web_current=/var/www/traceforge
web_next=/var/www/traceforge-next
web_previous="/var/www/traceforge-prev-${stamp}"
nginx_current=/etc/nginx/conf.d/traceforge.conf
nginx_previous="${nginx_current}.prev-${stamp}"
service_current=/etc/systemd/system/traceforge.service
service_previous="${service_current}.prev-${stamp}"
staging_dir="${TRACEFORGE_DEPLOY_STAGING_DIR:?TRACEFORGE_DEPLOY_STAGING_DIR is required}"
nginx_staged="${staging_dir}/traceforge.nginx.conf"
service_staged="${staging_dir}/traceforge.service"
local_health="${staging_dir}/local-health.json"
public_health="${staging_dir}/public-health.json"
public_root="${staging_dir}/public-root.html"
sse_headers="${staging_dir}/sse-headers.txt"
sse_body="${staging_dir}/sse-body.txt"
migration_created="${staging_dir}/migration-created.json"
migration_job="${staging_dir}/migration-job.json"
migration_proof="${staging_dir}/migration-proof.json"
unit_verify_log="${staging_dir}/systemd-verify.log"
release_backups_to_keep="${TRACEFORGE_RELEASE_BACKUPS_TO_KEEP:-2}"

case "${staging_dir}" in
  /run/traceforge-release-*) ;;
  *) echo "unsafe TraceForge staging directory" >&2; exit 1 ;;
esac

test "$(id -u)" -eq 0
test ! -L "${staging_dir}"
test "$(stat -c %u "${staging_dir}")" -eq 0
test "$(stat -c %a "${staging_dir}")" = 700
test -f "${api_next}/dist/server.js"
test -f "${api_next}/release.json"
test -f "${web_next}/index.html"
test -f "${nginx_staged}"
test ! -L "${nginx_staged}"
test -f "${service_staged}"
test ! -L "${service_staged}"
case "${release_backups_to_keep}" in
  ''|*[!0-9]*) echo "TRACEFORGE_RELEASE_BACKUPS_TO_KEEP must be an integer" >&2; exit 1 ;;
esac
test "${release_backups_to_keep}" -ge 1
test "${release_backups_to_keep}" -le 10

resolve_nginx_binary() {
  local exec_start candidate
  exec_start="$(systemctl show nginx --property=ExecStart | sed -n 's/^ExecStart=//p')"
  candidate="$(printf '%s\n' "${exec_start}" | sed -n 's/.*path=\([^ ;}]*\).*/\1/p' | head -n 1)"
  if test -z "${candidate}"; then
    candidate="$(printf '%s\n' "${exec_start}" | sed 's/^[{ ]*//' | awk '{print $1}')"
  fi
  test -n "${candidate}"
  test -x "${candidate}"
  printf '%s\n' "${candidate}"
}

prune_directory_backups() {
  local parent="$1" prefix="$2" keep="$3" index
  local -a backups=()
  mapfile -t backups < <(
    find "${parent}" -mindepth 1 -maxdepth 1 -type d -name "${prefix}*" -printf '%f\t%p\n' \
      | sort -r | cut -f2-
  )
  for ((index=keep; index<${#backups[@]}; index+=1)); do
    rm -rf -- "${backups[index]}"
  done
}

prune_file_backups() {
  local parent="$1" prefix="$2" keep="$3" index
  local -a backups=()
  mapfile -t backups < <(
    find "${parent}" -mindepth 1 -maxdepth 1 -type f -name "${prefix}*" -printf '%f\t%p\n' \
      | sort -r | cut -f2-
  )
  for ((index=keep; index<${#backups[@]}; index+=1)); do
    rm -f -- "${backups[index]}"
  done
}

cleanup() {
  rm -rf -- "${staging_dir}" || true
}
trap cleanup EXIT

nginx_bin="$(resolve_nginx_binary)"

systemd-analyze verify "${service_staged}" >"${unit_verify_log}" 2>&1
if grep -E '^\[[^]]*/traceforge\.service:' "${unit_verify_log}" \
  | grep -Eiq 'Unknown lvalue|Failed to parse|Failed to load'; then
  cat "${unit_verify_log}" >&2
  echo "TraceForge systemd unit is not compatible with this host" >&2
  exit 1
fi

nginx_config_touched=0
service_config_touched=0
api_current_moved=0
api_next_activated=0
web_current_moved=0
web_next_activated=0

rollback() {
  status=$?
  trap - ERR
  set +e
  systemctl stop traceforge
  if test "${api_next_activated}" -eq 1 && test -d "${api_current}"; then
    mv "${api_current}" "/opt/traceforge-failed-${stamp}"
  fi
  if test "${api_current_moved}" -eq 1 && test -d "${api_previous}"; then
    mv "${api_previous}" "${api_current}"
  fi
  if test "${web_next_activated}" -eq 1 && test -d "${web_current}"; then
    mv "${web_current}" "/var/www/traceforge-failed-${stamp}"
  fi
  if test "${web_current_moved}" -eq 1 && test -d "${web_previous}"; then
    mv "${web_previous}" "${web_current}"
  fi
  if test "${nginx_config_touched}" -eq 1 && test -f "${nginx_previous}"; then
    cp -a "${nginx_previous}" "${nginx_current}"
  fi
  if test "${service_config_touched}" -eq 1 && test -f "${service_previous}"; then
    cp -a "${service_previous}" "${service_current}"
  fi
  systemctl daemon-reload
  systemctl start traceforge
  "${nginx_bin}" -t && systemctl reload nginx
  exit "${status}"
}

trap rollback ERR

cp -a "${nginx_current}" "${nginx_previous}"
cp -a "${service_current}" "${service_previous}"
nginx_config_touched=1
install -m 0644 "${nginx_staged}" "${nginx_current}"
service_config_touched=1
install -m 0644 "${service_staged}" "${service_current}"
"${nginx_bin}" -t

systemctl stop traceforge
mv "${api_current}" "${api_previous}"
api_current_moved=1
mv "${api_next}" "${api_current}"
api_next_activated=1
mv "${web_current}" "${web_previous}"
web_current_moved=1
mv "${web_next}" "${web_current}"
web_next_activated=1
chown -R root:root "${api_current}"
chown -R root:root "${web_current}"
install -d -o traceforge -g traceforge -m 0750 /var/lib/traceforge

systemctl daemon-reload
systemctl start traceforge
systemctl show traceforge -p ProtectSystem | grep -Fx 'ProtectSystem=full'
systemctl show traceforge -p ReadOnlyDirectories | grep -Fq '/opt/traceforge'
systemctl show traceforge -p ReadWriteDirectories | grep -Fq '/var/lib/traceforge'
systemctl show traceforge -p MemoryLimit | grep -Fx 'MemoryLimit=1610612736'
systemctl show traceforge -p TasksMax | grep -Fx 'TasksMax=256'
systemctl show traceforge -p CPUQuotaPerSecUSec | grep -Fx 'CPUQuotaPerSecUSec=2s'
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:4034/api/health >"${local_health}"; then
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:4034/api/health >"${local_health}"
systemctl reload nginx
curl -fsS https://traceforge.axiqo.xyz/api/health >"${public_health}"
EXPECTED_RELEASE_FILE="${api_current}/release.json" \
LOCAL_HEALTH_FILE="${local_health}" \
PUBLIC_HEALTH_FILE="${public_health}" \
/usr/local/bin/node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const expected = JSON.parse(readFileSync(process.env.EXPECTED_RELEASE_FILE, "utf8"));
  const local = JSON.parse(readFileSync(process.env.LOCAL_HEALTH_FILE, "utf8")).release;
  const publicRelease = JSON.parse(readFileSync(process.env.PUBLIC_HEALTH_FILE, "utf8")).release;
  if (JSON.stringify(local) !== JSON.stringify(expected)) process.exit(1);
  if (JSON.stringify(publicRelease) !== JSON.stringify(expected)) process.exit(1);
'
curl -fsSI https://traceforge.axiqo.xyz/ | tr -d '\r' | grep -Eiq '^cache-control:.*no-cache.*no-store.*must-revalidate'
curl -fsSI https://traceforge.axiqo.xyz/index.html | tr -d '\r' | grep -Eiq '^cache-control:.*no-cache.*no-store.*must-revalidate'
curl -fsS https://traceforge.axiqo.xyz/ >"${public_root}"
grep -Eq '<div[^>]+id="root"' "${public_root}"

# Express treats a single trailing slash as equivalent by default. Assert that
# Nginx enforces the public read-only boundary for both spellings instead of
# allowing the slash form to fall through to the general API proxy.
for blocked_path in \
  /api/traces/capture /api/traces/capture/ \
  /api/verifications /api/verifications/ \
  /api/verifications/suite /api/verifications/suite/ \
  /api/Verifications /api/verifications/SUITE/; do
  blocked_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "https://traceforge.axiqo.xyz${blocked_path}")"
  test "${blocked_status}" = "403"
done
for codex_path in /api/adapters/codex/repair /api/adapters/codex/repair/ /api/adapters/Codex/Repair/; do
  codex_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "https://traceforge.axiqo.xyz${codex_path}")"
  test "${codex_status}" = "501"
done

# Start one server-owned replay locally, then consume its public SSE stream.
# This proves that the deployed proxy preserves event-stream headers and that
# the new release can still issue a complete proof through the public route.
curl -fsS \
  -H 'Content-Type: application/json' \
  -d '{"executionMode":"recorded-replay"}' \
  http://127.0.0.1:4034/api/migrations >"${migration_created}"
migration_id="$(MIGRATION_FILE="${migration_created}" /usr/local/bin/node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const body = JSON.parse(readFileSync(process.env.MIGRATION_FILE, "utf8"));
  if (typeof body?.data?.id !== "string") process.exit(1);
  process.stdout.write(body.data.id);
')"
curl -fsS --no-buffer --max-time 180 \
  -D "${sse_headers}" \
  -H 'Accept: text/event-stream' \
  "https://traceforge.axiqo.xyz/api/migrations/${migration_id}/events" >"${sse_body}"
tr -d '\r' <"${sse_headers}" | grep -Eiq '^content-type: *text/event-stream'
tr -d '\r' <"${sse_headers}" | grep -Eiq '^x-accel-buffering: *no'
grep -Eq '^event: migration$' "${sse_body}"
grep -Eq '"type":"job.completed"' "${sse_body}"
if grep -Eq '"type":"job.failed"' "${sse_body}"; then
  echo "TraceForge SSE smoke migration failed" >&2
  exit 1
fi
curl -fsS "https://traceforge.axiqo.xyz/api/migrations/${migration_id}" >"${migration_job}"
curl -fsS "https://traceforge.axiqo.xyz/api/migrations/${migration_id}/proof" >"${migration_proof}"
JOB_FILE="${migration_job}" PROOF_FILE="${migration_proof}" /usr/local/bin/node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const job = JSON.parse(readFileSync(process.env.JOB_FILE, "utf8")).data;
  const proof = JSON.parse(readFileSync(process.env.PROOF_FILE, "utf8")).data;
  const proofScenarioIds = proof.scenarios.map(({ scenarioId }) => scenarioId);
  const proofScenarioSet = proof.scenarios.map(({ scenarioId, partition, proofDigest }) => ({
    scenarioId,
    partition,
    proofDigest,
  }));
  if (job.status !== "passed" || proof.status !== "PASSED") process.exit(1);
  if (proof.coverage.total !== 7 || proof.coverage.passed !== 7) process.exit(1);
  if (JSON.stringify(job.verifiedScenarioIds) !== JSON.stringify(proofScenarioIds)) process.exit(1);
  if (JSON.stringify(job.verifiedScenarioSet) !== JSON.stringify(proofScenarioSet)) process.exit(1);
  if (job.scenarioSetDigest !== proof.scenarioSetDigest) process.exit(1);
'

systemctl is-active --quiet traceforge
systemctl is-active --quiet nginx
trap - ERR
prune_directory_backups /opt traceforge-prev- "${release_backups_to_keep}"
prune_directory_backups /var/www traceforge-prev- "${release_backups_to_keep}"
prune_directory_backups /opt traceforge-failed- 1
prune_directory_backups /var/www traceforge-failed- 1
prune_file_backups /etc/nginx/conf.d traceforge.conf.prev- "${release_backups_to_keep}"
prune_file_backups /etc/systemd/system traceforge.service.prev- "${release_backups_to_keep}"
echo "TraceForge release installed: ${stamp}"
