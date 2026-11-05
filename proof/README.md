# Pharos On-Chain Alert Bot — submission evidence

**Challenge:** EASY / TRADING & MONITORING, 50 points (+50 optional video).

**Proof Link (deployed dashboard):** https://on-chain-alert-bot.trantanlong2411.workers.dev/  
**Repo Link:** https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot

## Verified without Telegram

- [CI tests and real Atlantic confirmed USDC transaction](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions/workflows/verify.yml) verifies amount, sender, receiver, exact Transfer receipt log and Telegram message text with a direct explorer URL.
- [Production Worker readiness](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions/workflows/verify-deployed.yml) verifies live dashboard, chain ID 688689, durable storage and admin protection.

These do **not** prove Telegram delivery. Do not report Telegram as successfully tested until the user has configured the bot and observed the real Telegram alert.

## Full proof procedure — manual owner verification

1. In Cloudflare, configure encrypted `TELEGRAM_BOT_TOKEN` and `ADMIN_API_KEY` and set `TELEGRAM_CHAT_ID`. Use no private wallet key.
2. Open Worker home, enter ADMIN_API_KEY in the dashboard and set threshold 0.001 USDC.
3. Send Telegram connection test, confirm received message marked test (not on-chain).
4. Inspect a real known confirmed Atlantic USDC transfer [0x4a603ea2…61e1](https://atlantic.pharosscan.xyz/tx/0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1), amount **0.003 USDC**. The resulting Telegram message must include event, value, UTC detection time, block and full explorer URL. Verify dashboard shows SENT.
5. Inspect the same hash again. It must return DUPLICATE, with no extra Telegram on-chain alert.
6. Capture the message, the website SENT row and duplicate response. Conceal ADMIN_API_KEY and bot token.

The bot also runs with Cloudflare Cron once a minute to detect new USDC transfers. The manual historic tx inspection is a reproducible *real* on-chain delivery demo, not a fabricated event.

The final score is determined by Pharos reviewers.
