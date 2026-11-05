# Configure Telegram and complete Pharos On-Chain Alert Bot

The GitHub repository is already linked to the Cloudflare Worker named `on-chain-alert-bot`. Confirm builds deploy branch `main` with `npx wrangler deploy`. The code is deployed and [production readiness has passed](https://github.com/trantanlong2411-droid/On-Chain-Alert-Bot/actions/runs/42007487325).

## Remaining one-time owner setup (do not share any secrets)

1. Create a dedicated bot in Telegram via [@BotFather](https://t.me/BotFather) with `/newbot`. Save the bot token privately.
2. Open your new bot conversation and send `/start`. To obtain your private chat ID, call Telegram [getUpdates](https://core.telegram.org/bots/api#getupdates) using your bot token **only in your own local environment**. The reply's `result[].message.chat.id` is the target chat ID. **Never post the URL containing the token**, share a bot token with ChatGPT, or commit it to GitHub.
3. In Cloudflare → Workers & Pages → `on-chain-alert-bot` → Settings → Variables and Secrets, add:
   - `TELEGRAM_BOT_TOKEN` as an **encrypted Secret**.
   - `TELEGRAM_CHAT_ID` as a secret or non-secret variable containing the chat ID.
   - `ADMIN_API_KEY` as a **different encrypted Secret**, randomly generated with at least 16 characters. Do not use the Telegram bot token as this password.
4. Save/deploy variable changes. Open [live dashboard](https://on-chain-alert-bot.trantanlong2411.workers.dev/) and refresh; both Telegram and Admin flags should show CONFIGURED.
5. Enter ADMIN_API_KEY into the dashboard password field (never into GitHub or chat), set threshold to `0.001` USDC and click **Save threshold**.
6. Click **Send Telegram connection test**. Confirm a test notification arrives in your Telegram chat. This is not the actual task alert.
7. In the historical real transaction box, use `0x4a603ea2d43512a76cc21f2d64b09e1ec4e07c34adc929526b514289ccfa61e1`; click **Inspect real TX & send alert**. Verify a real **0.003 USDC** Transfer alert appears in Telegram with its actual explorer link and UTC observation time. The website's recent event row should show **SENT**.
8. Click **Inspect real TX & send alert** again with the same hash. The second response must say **DUPLICATE** and no new Telegram alert should appear.
9. Check **Scan latest blocks**. Cron automatically invokes the same scanning logic every minute, with persistent cursor and event deduplication. Cloudflare's dashboard shows **Triggers → Cron Triggers**.
10. Capture proof screenshots of the Telegram alert and website results (hide ADMIN_API_KEY and Telegram bot token). After completing both tests, use the **website itself as Pharos Proof Link** and GitHub as Repo Link.

For a public demo, the dashboard is read-only for viewers and does not expose Telegram or admin credentials. Its actions for threshold changes, manual scans and Telegram sends require ADMIN_API_KEY.

No crypto wallet or private signing keys are used. Do not claim Telegram delivery complete based solely on CI or a test message. A real alert and subsequent DUPLICATE result provide the strongest evidence for all four task requirements.
