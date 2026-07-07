import fs from 'node:fs';
import { paths, readJsonLines } from './journal.js';

const trades = readJsonLines(paths.trades);
let equity = 0;
let peak = 0;
let maxDrawdown = 0;
let longestLossStreak = 0;
let currentLossStreak = 0;

for (const trade of trades) {
  equity += Number(trade.profit || 0);
  peak = Math.max(peak, equity);
  maxDrawdown = Math.max(maxDrawdown, peak - equity);
  if (Number(trade.profit || 0) > 0) currentLossStreak = 0;
  else currentLossStreak += 1;
  longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
}

const wins = trades.filter((trade) => Number(trade.profit || 0) > 0).length;
const losses = trades.length - wins;
const totalPnl = trades.reduce((sum, trade) => sum + Number(trade.profit || 0), 0);
const averagePnl = trades.length ? totalPnl / trades.length : 0;
const winRate = trades.length ? (wins / trades.length) * 100 : 0;

const byDirection = ['CALL', 'PUT'].map((direction) => {
  const items = trades.filter((trade) => trade.direction === direction);
  const pnl = items.reduce((sum, trade) => sum + Number(trade.profit || 0), 0);
  const directionWins = items.filter((trade) => Number(trade.profit || 0) > 0).length;
  return { direction, count: items.length, pnl, winRate: items.length ? directionWins / items.length * 100 : 0 };
});

const report = `# Deriv V75 (1s) seven-day test report

Generated: ${new Date().toISOString()}

## Results

- Trades: ${trades.length}
- Wins: ${wins}
- Losses: ${losses}
- Win rate: ${winRate.toFixed(2)}%
- Total P/L: ${totalPnl.toFixed(2)}
- Average P/L per trade: ${averagePnl.toFixed(2)}
- Maximum closed-trade drawdown: ${maxDrawdown.toFixed(2)}
- Longest loss streak: ${longestLossStreak}

## Direction breakdown

${byDirection.map((item) => `- ${item.direction}: ${item.count} trades, ${item.winRate.toFixed(2)}% wins, P/L ${item.pnl.toFixed(2)}`).join('\n')}

## Decision gate

Do not enable real-money execution from a one-week result. Continue demo testing unless there are at least 300 independent trades, positive net expectancy after actual contract pricing, acceptable drawdown, and stable results across different periods. No martingale or stake escalation should be introduced to manufacture a prettier equity curve.
`;

fs.writeFileSync('data/weekly-report.md', report, 'utf8');
console.log(report);
console.log('\nSaved to data/weekly-report.md');
