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

nginx_config_touched=0
service_config_touched=0
api_current_moved=0
api_next_activated=0
web_current_moved=0
web_next_activated=0

cleanup() {
  rm -rf -- "${staging_dir}" || true
}

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
  nginx -t && systemctl reload nginx
  exit "${status}"
}

trap rollback ERR
trap cleanup EXIT

cp -a "${nginx_current}" "${nginx_previous}"
cp -a "${service_current}" "${service_previous}"
nginx_config_touched=1
install -m 0644 "${nginx_staged}" "${nginx_current}"
service_config_touched=1
install -m 0644 "${service_staged}" "${service_current}"
nginx -t

systemctl stop traceforge
mv "${api_current}" "${api_previous}"
api_current_moved=1
mv "${api_next}" "${api_current}"
api_next_activated=1
mv "${web_current}" "${web_previous}"
web_current_moved=1
mv "${web_next}" "${web_current}"
web_next_activated=1
chown -R traceforge:traceforge "${api_current}"
chown -R root:root "${web_current}"

systemctl daemon-reload
systemctl start traceforge
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:4034/api/health >"${local_health}"; then
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:4034/api/health >/dev/null
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

systemctl is-active --quiet traceforge
systemctl is-active --quiet nginx
trap - ERR
echo "TraceForge release installed: ${stamp}"
