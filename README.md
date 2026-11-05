# On-Chain Alert Bot — Pharos Agent Arena

**Easy / Trading & Monitoring · 50 points (+50 optional video)**

- **Demo / intended Proof Link:** https://on-chain-alert-bot.trantanlong2411.workers.dev/
- **Repo:** https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot
- **Network:** Pharos Atlantic Testnet, eip155:688689 (no wallet, gas, or private signing keys needed)

## Challenge coverage

| Requirement | Implementation |
|---|---|
| Configurable alert rule | Watch Circle USDC Transfer events on Atlantic, trigger for amount at least `ALERT_MIN_USDC` (default 0.01 USDC), changeable via authenticated web dashboard |
| Real alert channel | Telegram Bot API `sendMessage` with encrypted Worker secret `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` |
| What, value, and TX explorer link | Message contains actual USDC amount, from/to wallets, block, observed UTC time, and direct Atlantic Explorer transaction URL |
| No repeat spam | SQLite Durable Object table keyed by unique `txHash:logIndex`, reserved before Telegram delivery; duplicates suppressed, ambiguous deliveries never automatically retried |

Cloudflare Cron runs every minute (`* * * * *`). A durable cursor scans up to 96 confirmed blocks per pass, ignoring removed/invalid/zero transfers. Each run caps new alerts at five for anti-spam. The timestamp in a Telegram message is the **time detected**, not a verified block timestamp. The deduplication policy deliberately prefers at-most-once messages over blindly retrying ambiguous deliveries. A very busy chain can cause catch-up delay.

## Deployment to your existing linked Cloudflare Worker

Confirm **Cloudflare → Workers & Pages → on-chain-alert-bot → Settings → Builds** has the repository `trantanlong2411-droid/On-Chain-Alert-Bot`, branch `main`, root `/`, and deploy command **`npx wrangler deploy`** (do not use `npm run build` as the deploy command). The committed `wrangler.jsonc` defines Worker name, Cron Trigger, and SQLite Durable Object binding `WATCH_STATE` for class `WatchState`.

**Configure these three values under Settings → Variables and Secrets:**

1. **`TELEGRAM_BOT_TOKEN`** — **Encrypted Secret**, from Telegram [@BotFather](https://t.me/BotFather). Do not paste it in GitHub or ChatGPT.
2. **`TELEGRAM_CHAT_ID`** — Telegram private chat/group ID (you must start the bot in your private chat first). Secret or public variable.
3. **`ADMIN_API_KEY`** — your own randomly generated **Encrypted Secret** of at least 16 characters. This protects writing configuration and manually triggering an alert.

Public default settings: `ATLANTIC_RPC_URL=https://atlantic.dplabs-internal.com`, `USDC_CONTRACT=0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`, `ALERT_MIN_USDC=0.01`, `FINALITY_BLOCKS=3`. Threshold changes made through the dashboard persist in the Durable Object.

**No wallet keys, test USDC, wallet connect, gas funding, or smart-contract deployment is required.** Monitoring is read-only.

## Reviewer demonstration: a real Telegram alert + no repeats

1. Open https://on-chain-alert-bot.trantanlong2411.workers.dev/ and confirm public `/api/health` and `/api/status` are working.
2. Enter **`ADMIN_API_KEY`** in the dashboard. This is *not* the Telegram bot token, and is not stored by the page.
3. Set threshold to **0.001 USDC**, click **Save threshold**.
4. Click **Send Telegram connection test**; confirm you actually receive a Telegram test notification. It is explicitly labeled **not** an on-chain alert.
5. Click **Inspect real TX & send alert** using the confirmed actual Atlantic transfer [0x4a603ea2…61e1](https://atlantic.pharosscan.xyz/tx/0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1) of **0.003 USDC**. The Worker inspects its real successful receipt, validates USDC Transfer logs, amount and confirmations, and sends the genuine Telegram alert including what occurred, value and explorer link.
6. Click **Inspect real TX & send alert** a second time with the **same hash**: result must be **`DUPLICATE`**, with **no second Telegram alert**. Dashboard log must show exactly one row for the event, with delivery `SENT` if Telegram succeeded.
7. Optionally click **Scan latest blocks** to verify the automatic monitoring; Cron also scans periodically. Capture screenshots of the Telegram message, unique event entry, and duplicate result **without exposing secrets or admin password**.

This historic confirmed transaction provides reproducible proof even when there are no new large transfers during a review. The official reviewer determines final points. **A green GitHub test or Cloudflare deployment alone does not prove Telegram delivery**; do not claim that until the user sees a received real alert.

## Endpoints

- `GET /` — public dashboard
- `GET /api/health` — public readiness, chain, and secret-presence flags only
- `GET /api/status` — public scan cursor, configured threshold, recent real event records
- `POST /api/admin/threshold` — Bearer ADMIN_API_KEY, save threshold
- `POST /api/admin/telegram-test` — Bearer ADMIN_API_KEY, connection test only
- `POST /api/admin/inspect-tx` — Bearer ADMIN_API_KEY, verify real tx and send idempotent alert
- `POST /api/admin/scan` — Bearer ADMIN_API_KEY, trigger scanning now

## Code and evidence

- `src/config.mjs` — validated threshold, trusted testnet and token.
- `src/monitor.mjs` — RPC verification, event parsing, token amount, Telegram alert format, scan windows.
- `src/worker.mjs` — Cron and SQLite durable deduplication, delivery state, public dashboard routes and protected admin actions.
- `src/page.mjs` — live status / threshold / historical real tx demonstration.
- `scripts/verify-atlantic.mjs` — read-only actual chain event proof, without claiming Telegram delivery.
- `tests/monitor.test.mjs` — 6 protocol, amount, message and network checks.
- [GitHub Actions CI](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions) — unit tests, Wrangler build, actual Pharos USDC transfer audit.

Reference: [Cloudflare Cron docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage) · [Pharos Network docs](https://docs.pharos.xyz/getting-started/network).
