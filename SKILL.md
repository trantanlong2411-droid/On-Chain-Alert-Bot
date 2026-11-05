---
name: pharos-on-chain-alert-bot
description: A Telegram alert monitor for actual confirmed USDC Transfer events on Pharos Atlantic Testnet.
---
# On-Chain Alert Bot

- Use only Pharos Atlantic chain 688689 and the configured official Circle USDC token contract.
- Scan confirmed blocks with an adjustable minimum amount in six-decimal USDC atomic units; use a persistently saved block cursor.
- Cloudflare Cron invokes the worker's scheduled handler every minute. Do not claim this is a webhook or continuous WebSocket stream.
- Every alert is constructed from a validated real ERC-20 Transfer log and includes what happened, token value, from/to, block number, UTC detection time, and a public Atlantic explorer transaction link.
- Telegram delivery requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID configured privately in Cloudflare; never commit or print secrets.
- The event's unique key is transaction hash plus log index. Reserve it before sending Telegram. Duplicate or uncertain delivery is never automatically resent, preventing repeated spam.
- Only the admin with ADMIN_API_KEY may change thresholds, run live scans, send a connection test, or inspect an already-confirmed transaction to reproduce a real alert.
- The Telegram connection test must be marked as a test. A real on-chain alert must come from the actual transaction receipt (not a fabricated sample).
- Do not call the task complete until Telegram shows the actual alert and the repeated inspect action returns DUPLICATE, in addition to code/deployment CI.
