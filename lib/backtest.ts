export type Strategy = "maRsi" | "breakout" | "mean";

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BacktestParams = {
  strategy: Strategy;
  fast: number;
  slow: number;
  rsiPeriod: number;
  rsiBuy: number;
  capital: number;
  risk: number;
  fee: number;
  slippage: number;
  stop: number;
  take: number;
};

export type Trade = {
  date: string;
  action: "BUY" | "SELL";
  price: number;
  qty: number;
  cash: number;
  equity: number;
  pnl: number | null;
};

export type BacktestResult = {
  params: BacktestParams;
  fastMa: Array<number | null>;
  slowMa: Array<number | null>;
  rsiVals: Array<number | null>;
  equity: number[];
  trades: Trade[];
  finalEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  buyHold: number;
};

export const defaultParams: BacktestParams = {
  strategy: "maRsi",
  fast: 12,
  slow: 48,
  rsiPeriod: 14,
  rsiBuy: 55,
  capital: 10000,
  risk: 0.95,
  fee: 0.001,
  slippage: 0.0005,
  stop: 0.08,
  take: 0.18,
};

export function makeSampleData(): Candle[] {
  const out: Candle[] = [];
  const start = new Date("2022-01-01T00:00:00Z");
  let price = 46200;

  for (let i = 0; i < 860; i += 1) {
    const cycle = Math.sin(i / 32) * 0.018 + Math.sin(i / 91) * 0.012;
    const shock = Math.sin(i * 1.7) * 0.006 + Math.cos(i / 13) * 0.009;
    const drift = i < 310 ? -0.0008 : i < 590 ? 0.0012 : -0.00015;
    price = Math.max(7000, price * (1 + cycle + shock + drift));
    const open = price * (1 + Math.sin(i / 7) * 0.004);
    const close = price;
    const high = Math.max(open, close) * (1 + 0.012 + Math.abs(Math.sin(i / 11)) * 0.018);
    const low = Math.min(open, close) * (1 - 0.012 - Math.abs(Math.cos(i / 17)) * 0.016);
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);

    out.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: 18000 + Math.abs(Math.sin(i / 9)) * 12000,
    });
  }

  return out;
}

export function parseCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines.shift() ?? "").map((value) => value.trim().toLowerCase());
  const pick = (name: string) => header.indexOf(name);
  const dateIdx = pick("date") >= 0 ? pick("date") : 0;
  const openIdx = pick("open") >= 0 ? pick("open") : 1;
  const highIdx = pick("high") >= 0 ? pick("high") : 2;
  const lowIdx = pick("low") >= 0 ? pick("low") : 3;
  const closeIdx = pick("close") >= 0 ? pick("close") : 4;
  const volumeIdx = pick("volume") >= 0 ? pick("volume") : 5;

  return lines
    .map((line) => {
      const cells = splitCsvLine(line).map((value) => value.trim());
      return {
        date: cells[dateIdx],
        open: Number(cells[openIdx]),
        high: Number(cells[highIdx]),
        low: Number(cells[lowIdx]),
        close: Number(cells[closeIdx]),
        volume: Number(cells[volumeIdx] || 0),
      };
    })
    .filter((candle) => candle.date && Number.isFinite(candle.close))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function sma(values: number[], period: number): Array<number | null> {
  const out = Array<number | null>(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

export function rsi(values: number[], period: number): Array<number | null> {
  const out = Array<number | null>(values.length).fill(null);
  let gain = 0;
  let loss = 0;

  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);

    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = 100 - 100 / (1 + gain / Math.max(loss, 1e-9));
      }
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
      out[i] = 100 - 100 / (1 + gain / Math.max(loss, 1e-9));
    }
  }

  return out;
}

export function normalizeParams(params: BacktestParams): BacktestParams {
  return {
    strategy: params.strategy,
    fast: Math.max(2, Number(params.fast)),
    slow: Math.max(3, Number(params.slow)),
    rsiPeriod: Math.max(2, Number(params.rsiPeriod)),
    rsiBuy: Number(params.rsiBuy),
    capital: Math.max(100, Number(params.capital)),
    risk: Math.min(1, Math.max(0.01, Number(params.risk))),
    fee: Math.max(0, Number(params.fee)),
    slippage: Math.max(0, Number(params.slippage)),
    stop: Math.max(0, Number(params.stop)),
    take: Math.max(0, Number(params.take)),
  };
}

export function runBacktest(candles: Candle[], rawParams: BacktestParams): BacktestResult {
  const params = normalizeParams(rawParams);
  const required = Math.max(params.slow, params.rsiPeriod) + 5;
  if (candles.length < required) {
    throw new Error("数据太少，无法计算策略指标。");
  }

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const fastMa = sma(closes, params.fast);
  const slowMa = sma(closes, params.slow);
  const rsiVals = rsi(closes, params.rsiPeriod);
  let cash = params.capital;
  let coin = 0;
  let entryPrice = 0;
  let entryCost = 0;
  let inPosition = false;
  const trades: Trade[] = [];
  const equity: number[] = [];
  let peak = params.capital;
  let maxDrawdown = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const markEquity = cash + coin * closes[i];
    equity.push(markEquity);
    peak = Math.max(peak, markEquity);
    maxDrawdown = Math.min(maxDrawdown, (markEquity - peak) / peak);

    if (!fastMa[i] || !slowMa[i] || !rsiVals[i]) continue;

    const signal = signalAt(i, closes, highs, lows, fastMa, slowMa, rsiVals, params, inPosition, entryPrice);

    if (signal === "buy" && !inPosition) {
      const fill = closes[i] * (1 + params.slippage);
      const spend = cash * params.risk;
      const feeCost = spend * params.fee;
      coin = (spend - feeCost) / fill;
      cash -= spend;
      entryPrice = fill;
      entryCost = spend;
      inPosition = true;
      trades.push({
        date: candles[i].date,
        action: "BUY",
        price: fill,
        qty: coin,
        cash,
        equity: cash + coin * closes[i],
        pnl: null,
      });
    } else if (signal === "sell" && inPosition) {
      const fill = closes[i] * (1 - params.slippage);
      const gross = coin * fill;
      const feeCost = gross * params.fee;
      const proceeds = gross - feeCost;
      cash += proceeds;
      const pnl = proceeds - entryCost;
      trades.push({
        date: candles[i].date,
        action: "SELL",
        price: fill,
        qty: coin,
        cash,
        equity: cash,
        pnl,
      });
      coin = 0;
      entryPrice = 0;
      entryCost = 0;
      inPosition = false;
    }
  }

  const lastClose = closes[closes.length - 1];
  const finalEquity = cash + coin * lastClose;
  const sellTrades = trades.filter((trade) => trade.action === "SELL");
  const wins = sellTrades.filter((trade) => trade.pnl !== null && trade.pnl > 0).length;
  const buyHold = (lastClose / closes[0] - 1) * 100;
  const totalReturn = (finalEquity / params.capital - 1) * 100;

  return {
    params,
    fastMa,
    slowMa,
    rsiVals,
    equity,
    trades,
    finalEquity,
    totalReturn,
    maxDrawdown: maxDrawdown * 100,
    winRate: sellTrades.length ? (wins / sellTrades.length) * 100 : 0,
    buyHold,
  };
}

function signalAt(
  i: number,
  closes: number[],
  highs: number[],
  lows: number[],
  fastMa: Array<number | null>,
  slowMa: Array<number | null>,
  rsiVals: Array<number | null>,
  params: BacktestParams,
  inPosition: boolean,
  entryPrice: number,
): "buy" | "sell" | null {
  const price = closes[i];
  const fast = fastMa[i];
  const slow = slowMa[i];
  const prevFast = fastMa[i - 1];
  const prevSlow = slowMa[i - 1];
  const currentRsi = rsiVals[i];

  if (fast === null || slow === null || prevFast === null || prevSlow === null || currentRsi === null) {
    return null;
  }

  if (inPosition) {
    if (params.stop && price <= entryPrice * (1 - params.stop)) return "sell";
    if (params.take && price >= entryPrice * (1 + params.take)) return "sell";
  }

  if (params.strategy === "maRsi") {
    const crossUp = prevFast <= prevSlow && fast > slow;
    const crossDown = prevFast >= prevSlow && fast < slow;
    if (!inPosition && crossUp && currentRsi >= params.rsiBuy) return "buy";
    if (inPosition && (crossDown || currentRsi < 45)) return "sell";
  }

  if (params.strategy === "breakout") {
    const upper = highest(highs, params.fast, i);
    const lower = lowest(lows, params.fast, i);
    if (!inPosition && price > upper && fast > slow) return "buy";
    if (inPosition && (price < lower || fast < slow)) return "sell";
  }

  if (params.strategy === "mean") {
    if (!inPosition && currentRsi < Math.min(params.rsiBuy, 45) && price > slow) return "buy";
    if (inPosition && (currentRsi > 62 || price < slow)) return "sell";
  }

  return null;
}

function highest(values: number[], period: number, i: number): number {
  let max = -Infinity;
  for (let j = Math.max(0, i - period); j < i; j += 1) max = Math.max(max, values[j]);
  return max;
}

function lowest(values: number[], period: number, i: number): number {
  let min = Infinity;
  for (let j = Math.max(0, i - period); j < i; j += 1) min = Math.min(min, values[j]);
  return min;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      i += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}
