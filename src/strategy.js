import { averageTrueRange, ema, rsi } from './indicators.js';

export class EmaRsiStrategy {
  constructor() {
    this.bars = [];
  }

  addBar(bar) {
    this.bars.push(bar);
    if (this.bars.length > 300) this.bars.shift();
    if (this.bars.length < 30) return null;

    const closes = this.bars.map((item) => item.close);
    const previousCloses = closes.slice(0, -1);
    const fast = ema(closes, 8);
    const slow = ema(closes, 21);
    const previousFast = ema(previousCloses, 8);
    const previousSlow = ema(previousCloses, 21);
    const momentum = rsi(closes.slice(-40), 14);
    const atr = averageTrueRange(this.bars.slice(-40), 14);
    const last = this.bars.at(-1);

    if ([fast, slow, previousFast, previousSlow, momentum, atr].some((value) => value === null)) {
      return null;
    }

    const barRange = last.high - last.low;
    const isAbnormalSpike = barRange > atr * 2.5;
    if (isAbnormalSpike) return null;

    const crossedUp = previousFast <= previousSlow && fast > slow;
    const crossedDown = previousFast >= previousSlow && fast < slow;

    if (crossedUp && momentum >= 52 && momentum <= 68 && last.close > slow) {
      return {
        direction: 'CALL',
        reason: 'EMA 8 crossed above EMA 21 with controlled bullish RSI',
        indicators: { fast, slow, rsi: momentum, atr },
      };
    }

    if (crossedDown && momentum >= 32 && momentum <= 48 && last.close < slow) {
      return {
        direction: 'PUT',
        reason: 'EMA 8 crossed below EMA 21 with controlled bearish RSI',
        indicators: { fast, slow, rsi: momentum, atr },
      };
    }

    return null;
  }
}

export class BarAggregator {
  constructor(seconds, onBar) {
    this.seconds = seconds;
    this.onBar = onBar;
    this.current = null;
  }

  addTick(epoch, price) {
    const bucket = Math.floor(epoch / this.seconds) * this.seconds;
    if (!this.current || this.current.epoch !== bucket) {
      const completed = this.current;
      this.current = { epoch: bucket, open: price, high: price, low: price, close: price };
      if (completed) this.onBar(completed);
      return;
    }
    this.current.high = Math.max(this.current.high, price);
    this.current.low = Math.min(this.current.low, price);
    this.current.close = price;
  }
}
