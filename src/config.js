import 'dotenv/config';

const number = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

const integer = (name, fallback) => {
  const value = number(name, fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
};

const mode = (process.env.MODE || 'paper').toLowerCase();
if (!['paper', 'demo'].includes(mode)) {
  throw new Error('MODE must be paper or demo');
}

export const config = Object.freeze({
  appId: process.env.DERIV_APP_ID?.trim() || '',
  token: process.env.DERIV_TOKEN?.trim() || '',
  mode,
  symbol: process.env.SYMBOL?.trim() || '',
  targetDisplayName: process.env.TARGET_DISPLAY_NAME?.trim() || 'Volatility 75 (1s)',
  currency: process.env.CURRENCY?.trim() || 'USD',
  stake: number('STAKE', 0.35),
  durationTicks: integer('DURATION_TICKS', 30),
  barSeconds: integer('BAR_SECONDS', 15),
  maxTradesPerDay: integer('MAX_TRADES_PER_DAY', 8),
  maxDailyLoss: number('MAX_DAILY_LOSS', 3),
  maxConsecutiveLosses: integer('MAX_CONSECUTIVE_LOSSES', 3),
  cooldownSeconds: integer('COOLDOWN_SECONDS', 180),
  testDays: integer('TEST_DAYS', 7),
  timezone: process.env.TIMEZONE?.trim() || 'Africa/Johannesburg',
  port: integer('PORT', 3000),
});

export function validateConfig() {
  if (!config.appId || !/^\d+$/.test(config.appId)) {
    throw new Error('DERIV_APP_ID is required and must be numeric');
  }
  if (config.mode === 'demo' && !config.token) {
    throw new Error('DERIV_TOKEN is required in demo mode');
  }
  if (config.stake <= 0) throw new Error('STAKE must be greater than zero');
  if (config.durationTicks < 5) throw new Error('DURATION_TICKS must be at least 5');
  if (config.barSeconds < 1) throw new Error('BAR_SECONDS must be at least 1');
}
