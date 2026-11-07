# On-Chain Alert Bot: optional Telegram + no-secret ntfy deployment

This repo is linked to the Cloudflare Worker `on-chain-alert-bot`. With the v2 update, reviewers do **not** need Telegram or an admin key: the public website supports a dedicated **ntfy** channel, adjustable USDC threshold and actual confirmed transfer alerts with duplicate prevention.

## Configure Cloudflare deployment

Cloudflare → Workers & Pages → `on-chain-alert-bot` → Builds: GitHub `trantanlong2411-droid/On-Chain-Alert-Bot`, branch `main`, project root `/`, deploy command `npx wrangler deploy`.

The `wrangler.jsonc` file configures the original Cron Trigger and a SQLite Durable Object class `WatchState`. Personal ntfy channels use the existing DO binding, each with a unique ID and Alarm. No additional API key is required for the ntfy features.

After deployment, `GET /api/health` should report `pharos-onchain-alert-2026-11-07-v2` and `ntfyEnabled:true`.

## Public proof (no secrets)

1. Open https://on-chain-alert-bot.trantanlong2411.workers.dev/.
2. In **Create your own live push-alert channel**, enter `0.001` USDC and create.
3. Open the generated `https://ntfy.sh/pharos-alert-...` URL and subscribe.
4. Click **Verify real TX & send alert** on the prefilled transaction hash. It is confirmed Circle USDC **0.003** on Pharos Atlantic and must include an explorer link.
5. Click again; verify `DUPLICATE` and no second ntfy message.
6. Change minimum USDC, click **Save alert threshold**, then run **Scan recent confirmed blocks** or allow the Alarm to scan.
7. Capture the on-screen receipt and actual ntfy notification. Never show the private edit token.

## Optional Telegram original integration

If you still want the Telegram mode in addition to ntfy, privately configure three Cloudflare Settings → Variables and Secrets:
- `TELEGRAM_BOT_TOKEN` encrypted secret, obtained from [@BotFather](https://t.me/BotFather);
- `TELEGRAM_CHAT_ID` recipient chat ID (send /start to the bot and fetch message.chat.id from Telegram getUpdates *locally*);
- `ADMIN_API_KEY` a distinct encrypted secret of at least 16 characters; never use Telegram token as the admin secret.

The original admin controls allow a Telegram connection test, threshold change and confirmed historical transaction inspection. Public ntfy users never need these secrets.

Safety: ntfy topics are public and anyone with the topic URL can publish messages to it; avoid secrets and high-stakes alerts. The notification service can be unavailable or rate-limited; Cloudflare alarms can run late. A provider-acknowledged notification does not guarantee a mobile device displayed it. Scheduled polling and event history are bounded to prevent spam.
