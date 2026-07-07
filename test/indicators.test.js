import test from 'node:test';
import assert from 'node:assert/strict';
import { ema, rsi, averageTrueRange } from '../src/indicators.js';

test('EMA returns a finite value with enough data', () => {
  const value = ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.equal(Number.isFinite(value), true);
});

test('RSI is high for consistently rising values', () => {
  const values = Array.from({ length: 30 }, (_, index) => index + 1);
  assert.equal(rsi(values, 14), 100);
});

test('ATR returns a positive value', () => {
  const bars = Array.from({ length: 20 }, (_, index) => ({
    open: index + 1,
    high: index + 2,
    low: index + 0.5,
    close: index + 1.5,
  }));
  assert.ok(averageTrueRange(bars, 14) > 0);
});
