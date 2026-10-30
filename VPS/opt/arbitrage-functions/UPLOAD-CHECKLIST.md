# VPS upload checklist

1. Copy this folder to `/opt/arbitrage-functions` on the VPS (skip `.deb` files and `VPS/home/ubuntu/.docker`).
2. Create `/opt/arbitrage-functions/.env` (or systemd `Environment=` lines) with:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `ENCRYPTION_KEY` (same key used to encrypt exchange credentials)
   - `PORT` (default 8000), `ALLOWED_ORIGINS` (your app domains)
   - Optional: `SCANNER_EXCHANGES`, `SCAN_INTERVAL_SECONDS`, `MIN_PROFIT_PERCENT`, `CMC_API_KEY`
   - Safety: leave `TRADING_ENABLED=false` and `EXECUTION_MODE=dry_run` for the first run.
3. Install the service: `sudo cp deployment/arbitrage-bot.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now arbitrage-bot`
   (one entrypoint only: `server.ts`. Do not also run docker-compose or supervisor, or two workers will consume the queue.)
4. Check: `deno check supabase/functions/server.ts`, then `journalctl -u arbitrage-bot -f` and `curl http://localhost:8000/health`.
5. In the dashboard, confirm the VPS indicator is green and new opportunities appear.
6. Verify an exchange key from Settings (key check runs on the VPS, secrets never reach the browser).
7. Only after a successful dry-run trade appears in Live Trades: set `TRADING_ENABLED=true` and `EXECUTION_MODE=live`, approve real money in Admin, restart the service.
