# Deriv Volatility 75 (1s) seven-day bot experiment

This project streams live Deriv ticks, discovers the Volatility 75 (1s) symbol through `active_symbols`, builds 15-second bars, and tests a simple EMA/RSI strategy. It defaults to **paper mode**. Demo execution is available, but the code refuses to run if Deriv reports that the authorised account is real.

This is an experiment, not a profitable strategy claim. One week is enough to expose obvious nonsense, not enough to prove an edge. Humanity has tried very hard to make this distinction optional. It remains stubbornly real.

## Critical security step

The token shared in the chat and screenshot must be revoked immediately. It had broad scopes, including Payments, and is now exposed.

1. Open Deriv API Dashboard → **API tokens**.
2. Revoke/delete the exposed token.
3. Create a new token with only:
   - **Trade**
   - **Account management**
4. Do not select Payments or Application insights.
5. Store the new token only in `.env` or a hosting provider's secret settings.

Never paste the replacement token into chat, screenshots, GitHub, source files, or commit history.

## What the first version does

- Uses official Deriv WebSocket request patterns.
- Discovers Volatility 75 (1s) instead of trusting a hard-coded symbol.
- Warm-starts from historical ticks.
- Streams live ticks continuously.
- Builds 15-second bars.
- Uses EMA 8/21 crossover plus RSI and spike filters.
- Uses fixed stake only. No martingale.
- Allows one open trade at a time.
- Stops after the configured daily loss, daily trade count, or loss streak.
- Stops opening trades after seven days.
- Writes an append-only event log and trade journal.
- Exposes `/health` for monitoring.
- Generates a weekly Markdown report.

## Requirements

- Node.js 22 or newer.
- A registered Deriv app ID.
- A restricted token only when `MODE=demo`.

The current official Deriv JavaScript client also targets Node 22+, so this project uses Node's native WebSocket implementation and avoids another dependency merely for the thrill of maintaining it.

## Register the app

In the Deriv developer dashboard:

1. Open **Registered apps**.
2. Create an app for this experiment.
3. Copy the numeric App ID.
4. Use a localhost redirect URL if the form requires one. This bot uses PAT authentication, not browser OAuth, for the private demo experiment.

## Install

```bash
unzip deriv-v75-demo-bot.zip
cd deriv-v75-demo-bot
cp .env.example .env
nano .env
npm install
npm test
npm start
```

Minimum `.env` for the first 24 hours:

```env
DERIV_APP_ID=YOUR_NUMERIC_APP_ID
MODE=paper
```

Paper mode uses live Deriv market data and live proposal pricing, but does not send a buy request.

## Move to demo execution

After paper mode is stable:

```env
DERIV_APP_ID=YOUR_NUMERIC_APP_ID
DERIV_TOKEN=YOUR_NEW_RESTRICTED_TOKEN
MODE=demo
```

The bot checks the `is_virtual` field returned during authorisation. If the token resolves to a real account, it terminates with a safety-lock error.

## Monitor it

Open:

```text
http://localhost:3000/health
```

Important files:

- `data/events.jsonl`: connection, signal, risk-block and execution events.
- `data/trades.jsonl`: one record per completed paper/demo contract.
- `data/state.json`: persisted risk and test-window state.

## Keep it running locally

Your computer must remain powered on and connected. PM2 is the simplest option:

```bash
sudo npm install -g pm2
pm2 start src/bot.js --name deriv-v75-demo
pm2 save
pm2 startup
```

Use `pm2 logs deriv-v75-demo` to watch it and `pm2 stop deriv-v75-demo` for the emergency stop.

## Render deployment

A `render.yaml` file is included. Use a paid always-on web service for a continuous test. A sleeping free service is not a trading system; it is a decorative process that occasionally remembers its responsibilities.

Set these as Render secrets/environment variables:

- `DERIV_APP_ID`
- `MODE=paper` initially
- `DERIV_TOKEN` only after switching to demo

Do not put the token in `render.yaml`.

## Generate the report

After seven days:

```bash
npm run report
```

The report is saved to `data/weekly-report.md`.

## Sensible decision gate

Do not connect real money after one week. Continue demo testing until there are at least 300 independent trades and the strategy shows positive expectancy after real proposal pricing, acceptable drawdown, and similar results in different periods. Changing stakes after losses is prohibited by design because martingale is not risk management. It is arithmetic wearing a confidence costume.
