import type { BacktestResult, Candle } from "./backtest";

type DrawChartOptions = {
  canvas: HTMLCanvasElement;
  candles: Candle[];
  result: BacktestResult;
  formatUsd: (value: number) => string;
};

export function drawChart({ canvas, candles, result, formatUsd }: DrawChartOptions) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height || candles.length < 2) return;

  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * scale);
  canvas.height = Math.floor(rect.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(scale, scale);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 56, r: 46, t: 24, b: 36 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const closes = candles.map((candle) => candle.close);
  const priceSeries = [closes, result.fastMa, result.slowMa].flat().filter(isFiniteNumber);
  const minP = Math.min(...priceSeries) * 0.96;
  const maxP = Math.max(...priceSeries) * 1.04;
  const eq = result.equity.length ? result.equity : [result.params.capital];
  const minE = Math.min(...eq) * 0.96;
  const maxE = Math.max(...eq) * 1.04;
  const x = (i: number) => pad.l + (i / (candles.length - 1)) * plotW;
  const yP = (value: number) => pad.t + (1 - (value - minP) / (maxP - minP || 1)) * plotH;
  const yE = (value: number) => pad.t + (1 - (value - minE) / (maxE - minE || 1)) * plotH;

  ctx.strokeStyle = "#22302b";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const yy = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(w - pad.r, yy);
    ctx.stroke();
  }

  drawLine(ctx, closes, "#64d7e8", yP, x, 0, 2);
  drawLine(ctx, result.fastMa, "#f5c45f", yP, x, 0, 1.5);
  drawLine(ctx, result.slowMa, "#7aa8ff", yP, x, 0, 1.5);
  drawLine(ctx, result.equity, "#55d387", yE, x, 1, 2);

  result.trades.forEach((trade) => {
    const i = candles.findIndex((candle) => candle.date === trade.date);
    if (i < 0) return;
    const xx = x(i);
    const yy = yP(trade.price);
    ctx.fillStyle = trade.action === "BUY" ? "#55d387" : "#ff6b6b";
    ctx.beginPath();
    if (trade.action === "BUY") {
      ctx.moveTo(xx, yy - 8);
      ctx.lineTo(xx - 6, yy + 6);
      ctx.lineTo(xx + 6, yy + 6);
    } else {
      ctx.moveTo(xx, yy + 8);
      ctx.lineTo(xx - 6, yy - 6);
      ctx.lineTo(xx + 6, yy - 6);
    }
    ctx.closePath();
    ctx.fill();
  });

  ctx.fillStyle = "#98aaa1";
  ctx.font = "12px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(formatUsd(maxP), 10, pad.t + 5);
  ctx.fillText(formatUsd(minP), 10, h - pad.b);
  ctx.textAlign = "right";
  ctx.fillText(formatUsd(maxE), w - 8, pad.t + 5);
  ctx.fillText(formatUsd(minE), w - 8, h - pad.b);
  ctx.textAlign = "center";
  ctx.fillText(candles[0].date, pad.l, h - 12);
  ctx.fillText(candles[candles.length - 1].date, w - pad.r, h - 12);
}

function isFiniteNumber(value: number | null): value is number {
  return Number.isFinite(value);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  series: Array<number | null>,
  color: string,
  y: (value: number) => number,
  x: (index: number) => number,
  startOffset = 0,
  width = 2,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let moved = false;

  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    if (!Number.isFinite(value)) continue;
    const xx = x(i + startOffset);
    const yy = y(value as number);
    if (!moved) {
      ctx.moveTo(xx, yy);
      moved = true;
    } else {
      ctx.lineTo(xx, yy);
    }
  }

  ctx.stroke();
}
