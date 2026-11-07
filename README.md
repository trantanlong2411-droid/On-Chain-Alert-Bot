# On-Chain Alert Bot — Pharos Agent Arena

**Easy / Trading & Monitoring · 50 points (+50 for an optional real video)**

- **Public Worker / required Proof Link:** https://on-chain-alert-bot.trantanlong2411.workers.dev/
- **GitHub repository:** https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot
- **Network:** Pharos Atlantic Testnet (chain ID 688689)
- **Notification channel:** real [ntfy push notifications](https://ntfy.sh/) with no Telegram/admin secrets, plus optional legacy Telegram

## All four scoring requirements

| Task requirement | Code and proof |
| --- | --- |
| At least one configurable condition | Each private channel can set its own minimum confirmed Circle USDC transfer amount, validated to 6 decimals. The existing Telegram owner mode also supports a separate protected threshold. |
| Deliver to a real channel | The Cloudflare Worker POSTs a verified event to a unique, randomly generated ntfy topic. Reviewer opens the ntfy topic and subscribes via web/mobile. ntfy response includes a message ID; a separate production test checks the provider acknowledgement and tries reading the message back from its cache when supported. |
| Every alert includes event, amount, TX link | Alert includes exact USDC amount, sender, destination, block and real Atlantic Pharos explorer transaction link, sourced from a successful confirmed ERC-20 Transfer receipt or live indexed logs. |
| No repeat spam for one event | The SQLite-backed Durable Object writes a unique `txHash:logIndex` event ID **before** publishing. A second request returns `DUPLICATE` without re-sending. Timeout / uncertain results remain marked uncertain and aren't blindly retried. |

### How to demonstrate in 60 seconds without credentials

1. Open the [public website](https://on-chain-alert-bot.trantanlong2411.workers.dev/).
2. At the top under **Create your own live push-alert channel**, set the minimum transfer to **0.001 USDC** and click **Create personal channel**.
3. Click **Open and subscribe to ntfy channel**. On the ntfy website, subscribe to the topic if you want device/browser push. Topic URLs are intentionally public to anyone with the URL: do not place private information in alerts.
4. Click **Verify real TX & send alert**. The site fetches a real successful Pharos Atlantic testnet transaction receipt (hash `0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1`) and verifies that a **0.003 USDC** transfer actually occurred. It posts a real notification including amount, parties and explorer link.
5. Click **Verify real TX & send alert** again. The same event must return `DUPLICATE` and the ntfy channel should **not** receive a second copy.
6. Change threshold to `0.002` or another valid amount and click **Save alert threshold**. Click **Scan recent confirmed blocks** to manually run the actual monitor. The channel also schedules periodic scans automatically using a Durable Object Alarm (approximately every 2 minutes).
7. Review the public channel's recorded alerts / delivery status and [production delivery CI](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions). Public share links have read access; the editor/sender actions need a per-channel private edit token saved only in the creating browser tab.

**Actual device notification** requires the reviewer to subscribe to the ntfy topic; a successful service response or cached message proves ntfy acceptance, not reception by a particular device.

## How it works

- The original **Telegram/owner** mode remains intact. Its existing Cloudflare Cron Trigger checks Atlantic USDC `Transfer` events every minute. It requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `ADMIN_API_KEY` only if you want the Telegram mode. If the secrets aren't configured, it does not send Telegram messages.
- The new **personal ntfy** mode requires **zero secrets** and uses its own SQLite-backed Durable Object per topic. A high-entropy edit token is generated securely inside the Worker, returned once and SHA-256 hashed before being persisted. The raw token is never included in the share URL.
- The personal DO wakes via an **Alarm approximately every 120 seconds**, querying RPC for the correct Atlantic chain ID, a confirmed block head, and a bounded window of up to 96 blocks of authentic USDC logs. It stores a cursor and event identifiers for duplicate prevention and retains recent alerts. The first scan backfills only 96 confirmed blocks; earlier history isn't claimed.
- The first five qualifying events per poll are considered for delivery, preventing a large burst of pushes; additional qualified events in that window are reported as suppressed and aren't delivered. A personal channel also has a cap of 35 distinct stored alert attempts in a rolling 24h window. These anti-spam caps mean not every qualifying transaction is guaranteed to reach a push subscriber.
- A stored alert's `SENT` state means **ntfy or Telegram acknowledged** the event, not that a human saw it. An ambiguous network timeout is marked `DELIVERY_UNCERTAIN`; for no-repeat safety it won't automatically resend, potentially sacrificing some successful deliveries.
- Live testnet RPC: `https://atlantic.dplabs-internal.com`; official Circle USDC: `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B`; TX explorer: `https://atlantic.pharosscan.xyz/tx/`.
- No transaction signing, transfers, private keys or wallet connection. The alert is derived from observed transaction data.

## API

| Method | Route | Function |
| --- | --- | --- |
| GET | `/` | Public dashboard, ntfy wizard and optional Telegram legacy owner controls |
| GET | `/api/health` | Real Worker version, network and ntfy/Telegram capabilities |
| GET | `/api/status` | Public legacy watcher status |
| POST | `/api/ntfy/create` | `{"thresholdUSDC":"0.001"}` → unique private channel, edit token and subscription URL |
| GET | `/api/ntfy/:id` | Public personal channel history, threshold, delivery metadata |
| POST | `/api/ntfy/:id/threshold` | Authenticated threshold update |
| POST | `/api/ntfy/:id/test` | Authenticated ntfy connection test (rate-limited to once / 5 min) |
| POST | `/api/ntfy/:id/inspect` | Authenticated real TX receipt verification, send alert once |
| POST | `/api/ntfy/:id/scan` | Authenticated manual recent block scan |
| POST | `/api/admin/threshold`, `/api/admin/scan`, `/api/admin/inspect-tx`, `/api/admin/telegram-test` | Optional Telegram admin-only operations |

For private ntfy endpoints, send `Authorization: Bearer <editToken>` from the `create` result. Never put this secret in GitHub. Browser controls use sessionStorage. If lost, create a new personal channel.

## Testing & evidence

```bash
npm install
npm test
npm run build             # dry run only
node scripts/verify-atlantic.mjs
node scripts/smoke-deployed.mjs
node scripts/verify-ntfy-deployed.mjs   # creates an isolated real channel + performs two verified identical event checks
```

- [Workflow: unit, real Atlantic receipt, Worker build](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions)
- [Production ntfy proof](proof/ntfy-production-proof.json) (generated after successful end-to-end test)
- [Deployment guide](DEPLOYMENT.md) for optional Telegram credentials
- [Pharos documentation and official Chain MCP](https://github.com/PharosNetwork/pharos-mcp) (this legacy Atlantic watcher uses verified chain JSON-RPC events, which are on-chain data; it does not pretend to call Chain MCP)
- [ntfy publish API](https://docs.ntfy.sh/publish/), [ntfy polling API](https://docs.ntfy.sh/subscribe/api/)
- [Cloudflare Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

No video has been recorded. Actual score is determined by the external reviewer.


### Provider availability

The free official ntfy.sh service may return HTTP 429 when Cloudflare shares an outgoing IP with other publishers. New channels now send a real **welcome/test message at creation** and bind the topic to the first accepting host among the community-listed [ntfy.jae.fi](https://ntfy.jae.fi/), [ntfy.adminforge.de](https://ntfy.adminforge.de/) and [ntfy.sh](https://ntfy.sh/). The subscribe URL always points to the exact host selected during creation; events are never rerouted silently to a host the user did not subscribe to. These community instances are independent operators and may be unavailable or have their own policies, so they must not be used for confidential alerts. If all hosts reject publication, creation fails honestly.

**Evidence distinction:** The ntfy publish API confirming HTTP success and a message ID establishes service acceptance. Community hosts can disable or restrict cached replay, so the CI proof stores `ntfyCachedMessageVerified` independently. A personal device receives a push only after it subscribes and the provider/mobile platform delivers it. Do not interpret the `SENT` state as confirmed reception by an end user.
