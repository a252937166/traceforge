#!/usr/bin/env bash
set -euo pipefail

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

test "$(id -u)" -eq 0
test -f "${api_next}/dist/server.js"
test -f "${web_next}/index.html"
test -f /tmp/traceforge.nginx.conf
test -f /tmp/traceforge.service

cp -a "${nginx_current}" "${nginx_previous}"
cp -a "${service_current}" "${service_previous}"
install -m 0644 /tmp/traceforge.nginx.conf "${nginx_current}"
install -m 0644 /tmp/traceforge.service "${service_current}"

if ! nginx -t; then
  cp -a "${nginx_previous}" "${nginx_current}"
  cp -a "${service_previous}" "${service_current}"
  exit 1
fi

systemctl stop traceforge
mv "${api_current}" "${api_previous}"
mv "${api_next}" "${api_current}"
mv "${web_current}" "${web_previous}"
mv "${web_next}" "${web_current}"
chown -R traceforge:traceforge "${api_current}"
chown -R root:root "${web_current}"

rollback() {
  systemctl stop traceforge || true
  if test -d "${api_previous}"; then
    mv "${api_current}" "/opt/traceforge-failed-${stamp}" || true
    mv "${api_previous}" "${api_current}" || true
  fi
  if test -d "${web_previous}"; then
    mv "${web_current}" "/var/www/traceforge-failed-${stamp}" || true
    mv "${web_previous}" "${web_current}" || true
  fi
  cp -a "${nginx_previous}" "${nginx_current}" || true
  cp -a "${service_previous}" "${service_current}" || true
  systemctl daemon-reload || true
  systemctl start traceforge || true
  nginx -t && systemctl reload nginx || true
}
trap rollback ERR

systemctl daemon-reload
systemctl start traceforge
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:4034/api/health >/tmp/traceforge-release-health.json; then
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:4034/api/health >/dev/null
systemctl reload nginx
curl -fsS https://traceforge.axiqo.xyz/api/health >/dev/null

trap - ERR
systemctl is-active --quiet traceforge
systemctl is-active --quiet nginx
echo "TraceForge release installed: ${stamp}"
