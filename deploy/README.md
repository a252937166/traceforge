# TraceForge deployment controls

`traceforge.nginx.conf` is the only production TLS configuration. It keeps SSE proxy buffering disabled, adds a narrow perimeter limit for the expensive `POST /api/migrations` route, and blocks lower-level trace/ad hoc verification writes that the public workbench does not need. `nginx-traceforge-http.conf` is only an ACME bootstrap file and must be replaced after certificate issue.

`install-release.sh` is fail-closed and must run as root with a root-owned `0700` staging directory under `/run/traceforge-release-*`. It:

1. resolves the Nginx executable from the running `nginx.service` and tests the staged configuration with that binary;
2. activates root-owned API and Web release directories while keeping only `/var/lib/traceforge` writable by the service account;
3. verifies local and public release identity plus the public HTML shell;
4. starts a recorded replay, consumes it through the public SSE route, and requires a `7/7` proof whose scenario-set digest matches the terminal job;
5. rolls back on any failed check;
6. after success, retains only the newest two rollback releases by default.

`pnpm release:package` emits an API `package-lock.json`. Populate `/opt/traceforge-next` with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` before invoking the installer; do not resolve unpinned production dependencies on the live path.

Set `TRACEFORGE_RELEASE_BACKUPS_TO_KEEP` to an integer from `1` through `10` when a different rollback window is required. The API resource and retention defaults are listed in `traceforge.env.example`.

The hardened systemd unit is intentionally compatible with the deployment host's systemd 219. Code under `/opt/traceforge` is root-owned and explicitly read-only to the service, while SQLite may write only under `/var/lib/traceforge`. The unit uses the systemd 219 names `ReadOnlyDirectories`, `ReadWriteDirectories`, and `MemoryLimit`; the installer verifies their effective values instead of claiming newer directives that this host would ignore. A future server-side live Codex deployment needs a separately designed writable worktree boundary; do not weaken the public unit ad hoc.

The canonical Nginx configuration blocks the unused low-level mutation routes in both canonical and trailing-slash forms. `install-release.sh` verifies those perimeter responses after every reload, in addition to the public SSE and 7/7 proof smoke run.
