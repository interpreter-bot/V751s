import http from 'node:http';
import { config, validateConfig } from './config.js';
import { DerivClient } from './deriv-client.js';
import { appendEvent, appendTrade, loadState, saveState } from './journal.js';
import { BarAggregator, EmaRsiStrategy } from './strategy.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const strategy = new EmaRsiStrategy();
let state = loadState();
let runtime = { connected: false, symbol: null, mode: config.mode, lastTick: null, openTrade: null };
let liveSignalsEnabled = false;
let paperTrade = null;
let currentClient = null;

function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resetDailyStateIfNeeded() {
  const today = dateKey();
  if (state.dateKey !== today) {
    state.dateKey = today;
    state.tradesToday = 0;
    state.pnlToday = 0;
    state.consecutiveLosses = 0;
    state.haltedReason = null;
    saveState(state);
  }
}

function testWindowExpired() {
  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  return elapsed >= config.testDays * 24 * 60 * 60 * 1000;
}

function riskCheck() {
  resetDailyStateIfNeeded();
  if (testWindowExpired()) return 'Seven-day test window complete';
  if (state.haltedReason) return state.haltedReason;
  if (state.tradesToday >= config.maxTradesPerDay) return 'Daily trade limit reached';
  if (state.pnlToday <= -Math.abs(config.maxDailyLoss)) return 'Daily loss limit reached';
  if (state.consecutiveLosses >= config.maxConsecutiveLosses) return 'Consecutive-loss limit reached';
  if (state.lastTradeAt) {
    const elapsed = (Date.now() - new Date(state.lastTradeAt).getTime()) / 1000;
    if (elapsed < config.cooldownSeconds) return 'Cooldown active';
  }
  if (runtime.openTrade || paperTrade) return 'A trade is already open';
  return null;
}

function registerResult({ profit, outcome, details }) {
  state.tradesToday += 1;
  state.totalTrades += 1;
  state.pnlToday = Number((state.pnlToday + profit).toFixed(2));
  state.totalPnl = Number((state.totalPnl + profit).toFixed(2));
  state.consecutiveLosses = outcome === 'win' ? 0 : state.consecutiveLosses + 1;
  state.lastTradeAt = new Date().toISOString();

  if (state.pnlToday <= -Math.abs(config.maxDailyLoss)) state.haltedReason = 'Daily loss limit reached';
  if (state.consecutiveLosses >= config.maxConsecutiveLosses) state.haltedReason = 'Consecutive-loss limit reached';

  saveState(state);
  appendTrade({ mode: config.mode, profit, outcome, ...details });
  appendEvent('trade_closed', { profit, outcome, pnlToday: state.pnlToday, totalPnl: state.totalPnl });
}

async function discoverSymbol(client) {
  if (config.symbol) return config.symbol;
  const response = await client.request({ active_symbols: 'full' });
  const needle = config.targetDisplayName.toLowerCase().replace(/index/g, '').trim();
  const matches = response.active_symbols.filter((item) => {
    const name = String(item.display_name || '').toLowerCase().replace(/index/g, '').trim();
    return name.includes(needle);
  });
  if (matches.length !== 1) {
    const names = matches.map((item) => `${item.display_name} (${item.symbol})`).join(', ');
    throw new Error(`Could not uniquely identify ${config.targetDisplayName}. Matches: ${names || 'none'}`);
  }
  return matches[0].symbol;
}

async function warmUp(client, symbol, aggregator) {
  const response = await client.request({
    ticks_history: symbol,
    end: 'latest',
    count: 1200,
    style: 'ticks',
  }, 30_000);
  const times = response.history?.times || [];
  const prices = response.history?.prices || [];
  for (let index = 0; index < Math.min(times.length, prices.length); index += 1) {
    aggregator.addTick(Number(times[index]), Number(prices[index]));
  }
  appendEvent('warmup_complete', { ticks: times.length, bars: strategy.bars.length });
}

async function requestProposal(client, symbol, direction, currency) {
  const response = await client.request({
    proposal: 1,
    amount: config.stake,
    basis: 'stake',
    contract_type: direction,
    currency,
    duration: config.durationTicks,
    duration_unit: 't',
    symbol,
  });
  return response.proposal;
}

async function openPaperTrade(client, symbol, signal, quote, epoch, currency) {
  const proposal = await requestProposal(client, symbol, signal.direction, currency);
  paperTrade = {
    direction: signal.direction,
    reason: signal.reason,
    indicators: signal.indicators,
    entryQuote: Number(proposal.spot ?? quote),
    entryEpoch: epoch,
    ticksRemaining: config.durationTicks,
    askPrice: Number(proposal.ask_price ?? config.stake),
    payout: Number(proposal.payout ?? 0),
  };
  runtime.openTrade = { type: 'paper', direction: signal.direction, openedAt: new Date().toISOString() };
  appendEvent('paper_trade_opened', paperTrade);
}

function advancePaperTrade(quote, epoch, symbol) {
  if (!paperTrade) return;
  paperTrade.ticksRemaining -= 1;
  if (paperTrade.ticksRemaining > 0) return;

  const won = paperTrade.direction === 'CALL'
    ? quote > paperTrade.entryQuote
    : quote < paperTrade.entryQuote;
  const profit = won
    ? Number((paperTrade.payout - paperTrade.askPrice).toFixed(2))
    : Number((-paperTrade.askPrice).toFixed(2));

  registerResult({
    profit,
    outcome: won ? 'win' : 'loss',
    details: {
      symbol,
      direction: paperTrade.direction,
      reason: paperTrade.reason,
      entryQuote: paperTrade.entryQuote,
      exitQuote: quote,
      entryEpoch: paperTrade.entryEpoch,
      exitEpoch: epoch,
      stake: paperTrade.askPrice,
      payout: paperTrade.payout,
      indicators: paperTrade.indicators,
    },
  });
  paperTrade = null;
  runtime.openTrade = null;
}

async function openDemoTrade(client, symbol, signal, currency) {
  const proposal = await requestProposal(client, symbol, signal.direction, currency);
  const buyResponse = await client.request({ buy: proposal.id, price: proposal.ask_price });
  const contractId = buyResponse.buy.contract_id;
  runtime.openTrade = {
    type: 'demo',
    contractId,
    direction: signal.direction,
    openedAt: new Date().toISOString(),
  };
  appendEvent('demo_trade_opened', {
    contractId,
    direction: signal.direction,
    buyPrice: buyResponse.buy.buy_price,
    reason: signal.reason,
  });

  let subscriptionId;
  subscriptionId = await client.subscribe(
    { proposal_open_contract: 1, contract_id: contractId },
    async (response) => {
      const contract = response.proposal_open_contract;
      if (!contract?.is_sold) return;
      const profit = Number(contract.profit || 0);
      registerResult({
        profit,
        outcome: profit > 0 ? 'win' : 'loss',
        details: {
          symbol,
          contractId,
          direction: signal.direction,
          reason: signal.reason,
          entryQuote: contract.entry_spot,
          exitQuote: contract.exit_tick,
          stake: contract.buy_price,
          payout: contract.payout,
          indicators: signal.indicators,
        },
      });
      runtime.openTrade = null;
      await client.forget(subscriptionId).catch(() => {});
    },
  );
}

async function considerSignal(client, symbol, signal, quote, epoch, currency) {
  if (!liveSignalsEnabled || !signal) return;
  const blocked = riskCheck();
  if (blocked) {
    if (!['Cooldown active', 'A trade is already open'].includes(blocked)) {
      appendEvent('signal_blocked', { direction: signal.direction, reason: blocked });
    }
    return;
  }

  appendEvent('signal', { symbol, quote, epoch, ...signal });
  try {
    if (config.mode === 'paper') {
      await openPaperTrade(client, symbol, signal, quote, epoch, currency);
    } else {
      await openDemoTrade(client, symbol, signal, currency);
    }
  } catch (error) {
    runtime.openTrade = null;
    paperTrade = null;
    appendEvent('trade_open_failed', { message: error.message, direction: signal.direction });
  }
}

async function runSession() {
  const client = new DerivClient({ appId: config.appId });
  currentClient = client;
  await client.connect();
  runtime.connected = true;
  appendEvent('connected', { mode: config.mode });

  let currency = config.currency;
  if (config.mode === 'demo') {
    const response = await client.request({ authorize: config.token, add_to_login_history: 1 });
    const account = response.authorize;
    const isVirtual = account?.is_virtual === 1 || account?.is_virtual === true;
    if (!isVirtual) {
      client.close();
      throw new Error('SAFETY LOCK: token authorised a real account. This bot only permits virtual/demo accounts.');
    }
    currency = account.currency || currency;
    appendEvent('authorised_demo_account', {
      loginid: account.loginid,
      currency,
      isVirtual: true,
    });
  }

  const symbol = await discoverSymbol(client);
  runtime.symbol = symbol;
  appendEvent('symbol_selected', { symbol, displayName: config.targetDisplayName });

  let lastQuote = null;
  let lastEpoch = null;
  const aggregator = new BarAggregator(config.barSeconds, (bar) => {
    const signal = strategy.addBar(bar);
    if (signal && lastQuote !== null) {
      void considerSignal(client, symbol, signal, lastQuote, lastEpoch, currency);
    }
  });

  liveSignalsEnabled = false;
  await warmUp(client, symbol, aggregator);
  liveSignalsEnabled = true;

  await client.subscribe({ ticks: symbol }, (response) => {
    const tick = response.tick;
    if (!tick) return;
    const quote = Number(tick.quote);
    const epoch = Number(tick.epoch);
    lastQuote = quote;
    lastEpoch = epoch;
    runtime.lastTick = { quote, epoch, at: new Date(epoch * 1000).toISOString() };
    advancePaperTrade(quote, epoch, symbol);
    aggregator.addTick(epoch, quote);
  });

  await client.waitUntilClosed();
  runtime.connected = false;
  appendEvent('disconnected');
}

function startHealthServer() {
  const server = http.createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    response.writeHead(runtime.connected ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: runtime.connected,
      runtime,
      state,
      config: {
        mode: config.mode,
        targetDisplayName: config.targetDisplayName,
        stake: config.stake,
        durationTicks: config.durationTicks,
        maxTradesPerDay: config.maxTradesPerDay,
        maxDailyLoss: config.maxDailyLoss,
        testDays: config.testDays,
      },
    }, null, 2));
  });
  server.listen(config.port, () => appendEvent('health_server_started', { port: config.port }));
}

async function main() {
  validateConfig();
  resetDailyStateIfNeeded();
  startHealthServer();

  if (testWindowExpired()) {
    state.haltedReason = 'Seven-day test window complete';
    saveState(state);
    appendEvent('test_complete', { startedAt: state.startedAt, totalTrades: state.totalTrades, totalPnl: state.totalPnl });
    return;
  }

  appendEvent('bot_started', {
    mode: config.mode,
    testDays: config.testDays,
    demoLocked: config.mode === 'demo',
    strategy: 'EMA(8/21) crossover + RSI filter, fixed stake, no martingale',
  });

  while (!testWindowExpired()) {
    try {
      await runSession();
    } catch (error) {
      runtime.connected = false;
      appendEvent('session_error', { message: error.message });
      if (error.message.startsWith('SAFETY LOCK')) throw error;
    }
    await sleep(5_000);
  }

  state.haltedReason = 'Seven-day test window complete';
  saveState(state);
  appendEvent('test_complete', { totalTrades: state.totalTrades, totalPnl: state.totalPnl });
  currentClient?.close();
}

process.on('SIGINT', () => {
  appendEvent('shutdown', { signal: 'SIGINT' });
  currentClient?.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  appendEvent('shutdown', { signal: 'SIGTERM' });
  currentClient?.close();
  process.exit(0);
});

main().catch((error) => {
  appendEvent('fatal_error', { message: error.message, stack: error.stack });
  process.exitCode = 1;
});
