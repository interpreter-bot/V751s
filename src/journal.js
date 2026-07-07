import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data');
fs.mkdirSync(dataDir, { recursive: true });

const paths = {
  state: path.join(dataDir, 'state.json'),
  trades: path.join(dataDir, 'trades.jsonl'),
  events: path.join(dataDir, 'events.jsonl'),
};

export function appendEvent(type, data = {}) {
  const event = { timestamp: new Date().toISOString(), type, ...data };
  fs.appendFileSync(paths.events, `${JSON.stringify(event)}\n`, 'utf8');
  console.log(`[${event.timestamp}] ${type}`, data);
}

export function appendTrade(trade) {
  const record = { timestamp: new Date().toISOString(), ...trade };
  fs.appendFileSync(paths.trades, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  } catch {
    return {
      startedAt: new Date().toISOString(),
      dateKey: null,
      tradesToday: 0,
      pnlToday: 0,
      consecutiveLosses: 0,
      lastTradeAt: null,
      haltedReason: null,
      totalTrades: 0,
      totalPnl: 0,
    };
  }
}

export function saveState(state) {
  const temporary = `${paths.state}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(temporary, paths.state);
}

export function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export { paths };
