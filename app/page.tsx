"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BacktestParams,
  BacktestResult,
  Candle,
  Strategy,
  defaultParams,
  makeSampleData,
  parseCsv,
  runBacktest,
} from "@/lib/backtest";
import { drawChart } from "@/lib/chart";

const strategyNotes: Record<Strategy, string[]> = {
  maRsi: ["快线上穿慢线，且 RSI 高于阈值时买入。", "快线跌破慢线或 RSI 转弱时卖出。"],
  breakout: ["价格突破前 N 根最高价，且短期均线强于长期均线时买入。", "价格跌破前 N 根最低价或趋势转弱时卖出。"],
  mean: ["RSI 低位且价格仍在长期均线之上时买入。", "RSI 恢复到强势区或跌破长期均线时卖出。"],
};

const strategyLabels: Record<Strategy, string> = {
  maRsi: "均线交叉 + RSI 过滤",
  breakout: "唐奇安突破 + 趋势过滤",
  mean: "RSI 均值回归",
};

export default function Home() {
  const [candles, setCandles] = useState<Candle[]>(() => makeSampleData());
  const [params, setParams] = useState<BacktestParams>(defaultParams);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [status, setStatus] = useState("已载入内置样本，等待回测。");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [chartScale, setChartScale] = useState(1);

  const formatUsd = useCallback(
    (value: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value),
    [],
  );

  const formatPct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const formatNum = (value: number, digits = 4) =>
    Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });

  const executeBacktest = useCallback(() => {
    try {
      const nextResult = runBacktest(candles, params);
      setResult(nextResult);
      setError(null);
      if (candles.length) {
        setStatus(`${candles[0].date} 至 ${candles[candles.length - 1].date}，共 ${candles.length} 根 K 线。`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "回测失败。";
      setError(message);
      setResult(null);
      setStatus(message);
    }
  }, [candles, params]);

  useEffect(() => {
    executeBacktest();
  }, [executeBacktest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;

    drawChart({ canvas, candles, result, formatUsd });
  }, [candles, result, formatUsd]);

  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (canvas && result) drawChart({ canvas, candles, result, formatUsd });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [candles, result, formatUsd]);

  const latestNotes = useMemo(() => {
    if (!result || candles.length === 0) return ["暂无回测结果。"];

    const last = candles[candles.length - 1];
    const lastRsi = result.rsiVals[result.rsiVals.length - 1];
    const lastFast = result.fastMa[result.fastMa.length - 1];
    const lastSlow = result.slowMa[result.slowMa.length - 1];
    const latestTrade = result.trades[result.trades.length - 1];

    return [
      `最新收盘价：${formatUsd(last.close)}，RSI：${lastRsi ? lastRsi.toFixed(1) : "-"}`,
      `快线：${lastFast ? formatUsd(lastFast) : "-"}，慢线：${lastSlow ? formatUsd(lastSlow) : "-"}`,
      latestTrade
        ? `最近一次交易：${latestTrade.date} ${latestTrade.action}，价格 ${formatUsd(latestTrade.price)}`
        : "当前参数没有产生交易。",
    ];
  }, [candles, formatUsd, result]);

  const updateParam = <K extends keyof BacktestParams>(key: K, value: BacktestParams[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  const updateNumberParam = (key: keyof BacktestParams, value: string, scale = 1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setParams((current) => ({ ...current, [key]: parsed / scale }));
  };

  const handleCsv = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      setCandles(parsed);
      setStatus(`已导入 ${parsed.length} 条数据：${file.name}`);
    };
    reader.onerror = () => {
      setError("CSV 文件读取失败。");
      setStatus("CSV 文件读取失败。");
    };
    reader.readAsText(file);
  };

  const clampScale = (value: number) => Math.min(2.5, Math.max(0.6, Number(value.toFixed(2))));

  const restoreSample = () => {
    setCandles(makeSampleData());
    if (fileRef.current) fileRef.current.value = "";
    setStatus("已恢复内置 BTC 样本数据。");
  };

  const downloadTrades = () => {
    if (!result) return;

    const rows = [["date", "action", "price", "qty", "cash", "equity", "pnl"]].concat(
      result.trades.map((trade) => [
        trade.date,
        trade.action,
        String(trade.price),
        String(trade.qty),
        String(trade.cash),
        String(trade.equity),
        trade.pnl == null ? "" : String(trade.pnl),
      ]),
    );
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "crypto-backtest-trades.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="mark">₿</div>
          <div>
            <h1>Strategy Dashboard</h1>
            <p className="subtitle">BTC/USDT 回测工作台</p>
          </div>
        </div>

        <nav className="dashboard-nav" aria-label="Dashboard sections">
          <span className="nav-item active">策略参数</span>
          <span className="nav-item">结果可视化</span>
          <span className="nav-item">日志监控</span>
        </nav>

        <div className="section">
          <h2>数据</h2>
          <label className="file-input">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleCsv} />
            导入 CSV：date, open, high, low, close, volume
          </label>
          <div className="actions">
            <button className="ghost" type="button" onClick={restoreSample}>
              使用内置 BTC 数据
            </button>
            <button className="icon-btn" title="下载交易记录" type="button" onClick={downloadTrades}>
              ↓
            </button>
          </div>
        </div>

        <div className="section">
          <h2>策略</h2>
          <div className="field">
            <label htmlFor="strategy">模式</label>
            <select
              id="strategy"
              value={params.strategy}
              onChange={(event) => updateParam("strategy", event.target.value as Strategy)}
            >
              {Object.entries(strategyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <NumberField label="快线 / 短周期" id="fast" min={2} value={params.fast} onChange={(value) => updateNumberParam("fast", value)} />
            <NumberField label="慢线 / 长周期" id="slow" min={3} value={params.slow} onChange={(value) => updateNumberParam("slow", value)} />
          </div>
          <div className="row">
            <NumberField
              label="RSI 周期"
              id="rsiPeriod"
              min={2}
              value={params.rsiPeriod}
              onChange={(value) => updateNumberParam("rsiPeriod", value)}
            />
            <NumberField
              label="RSI 入场阈值"
              id="rsiBuy"
              min={1}
              max={99}
              value={params.rsiBuy}
              onChange={(value) => updateNumberParam("rsiBuy", value)}
            />
          </div>
        </div>

        <div className="section">
          <h2>资金与成本</h2>
          <div className="row">
            <NumberField label="初始资金 USDT" id="capital" min={100} value={params.capital} onChange={(value) => updateNumberParam("capital", value)} />
            <NumberField label="单次仓位 %" id="risk" min={1} max={100} value={Math.round(params.risk * 100)} onChange={(value) => updateNumberParam("risk", value, 100)} />
          </div>
          <div className="row">
            <NumberField label="手续费 %" id="fee" min={0} step={0.01} value={params.fee * 100} onChange={(value) => updateNumberParam("fee", value, 100)} />
            <NumberField
              label="滑点 %"
              id="slippage"
              min={0}
              step={0.01}
              value={params.slippage * 100}
              onChange={(value) => updateNumberParam("slippage", value, 100)}
            />
          </div>
          <div className="row">
            <NumberField label="止损 %" id="stop" min={0} step={0.1} value={params.stop * 100} onChange={(value) => updateNumberParam("stop", value, 100)} />
            <NumberField label="止盈 %" id="take" min={0} step={0.1} value={params.take * 100} onChange={(value) => updateNumberParam("take", value, 100)} />
          </div>
          <button type="button" onClick={executeBacktest}>
            运行回测
          </button>
        </div>
      </aside>

      <main>
        <div className="topbar">
          <div>
            <p className="eyebrow">Strategies / Mean Reversion BTC / Backtest</p>
            <h2>BTC/USDT Strategy Backtester</h2>
            <p className="subtitle">黑色多屏交易工作台，集成参数配置、回测可视化与信号监控。</p>
          </div>
          <div className="top-actions">
            <span className="market-pill">BTCUSDT</span>
            <span className="market-pill">1h</span>
            <button type="button" onClick={executeBacktest}>
              Run Backtest
            </button>
          </div>
        </div>

        <section className="hero-gallery" aria-label="Homepage visual overview">
          <article className="hero-card hero-card-large">
            <img src="/assets/generated/homepage-hero-trading-workstation.png" alt="多屏幕交易工作站" />
            <div className="hero-caption">
              <span>交易工作站</span>
              <strong>多屏行情、深度与策略概览</strong>
            </div>
          </article>
          <article className="hero-card">
            <img src="/assets/generated/homepage-hero-backtest-dashboard.png" alt="回测性能分析仪表盘" />
            <div className="hero-caption">
              <span>回测分析</span>
              <strong>权益、回撤与交易分布</strong>
            </div>
          </article>
          <article className="hero-card">
            <img src="/assets/generated/homepage-hero-python-algorithm.png" alt="Python 算法运行可视化" />
            <div className="hero-caption">
              <span>算法运行</span>
              <strong>信号、指标与执行链路</strong>
            </div>
          </article>
        </section>

        <div className={`status dashboard-status ${error ? "negative" : ""}`}>{status}</div>

        <section className="metrics">
          <Metric label="最终权益" value={result ? formatUsd(result.finalEquity) : "-"} />
          <Metric label="总收益" value={result ? formatPct(result.totalReturn) : "-"} tone={result && result.totalReturn >= 0 ? "positive" : "negative" } />
          <Metric label="最大回撤" value={result ? `${result.maxDrawdown.toFixed(2)}%` : "-"} tone="negative" />
          <Metric label="胜率" value={result ? `${result.winRate.toFixed(1)}%` : "-"} />
          <Metric label="交易次数" value={result ? String(result.trades.length) : "-"} />
          <Metric label="买入持有" value={result ? formatPct(result.buyHold) : "-"} tone={result && result.buyHold >= 0 ? "positive" : "negative"} />
        </section>

        <div className="workspace">
          <section className="chart-shell">
            <div className="shell-head">
              <h3>价格、信号与权益曲线</h3>
              <div className="legend">
                <span>
                  <i className="dot cyan-dot" />
                  价格
                </span>
                <span>
                  <i className="dot gold-dot" />
                  快线
                </span>
                <span>
                  <i className="dot blue-dot" />
                  慢线
                </span>
                <span>
                  <i className="dot green-dot" />
                  权益
                </span>
              </div>
            </div>
            <div className="chart-controls" aria-label="图表缩放控制">
              <button type="button" className="ghost" onClick={() => setChartScale((current) => clampScale(current - 0.1))}>
                缩小
              </button>
              <span>{Math.round(chartScale * 100)}%</span>
              <button type="button" className="ghost" onClick={() => setChartScale((current) => clampScale(current + 0.1))}>
                放大
              </button>
              <button type="button" className="ghost" onClick={() => setChartScale(1)}>
                重置
              </button>
            </div>
            <div
              className="chart-viewport"
              onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const delta = event.deltaY > 0 ? -0.08 : 0.08;
                setChartScale((current) => clampScale(current + delta));
              }}
            >
              <div className="chart-stage" style={{ transform: `scale(${chartScale})` }}>
                <canvas ref={canvasRef} width={1200} height={520} />
              </div>
            </div>
          </section>

          <div className="side-stack">
            <Notes title="策略说明" items={result ? [...strategyNotes[result.params.strategy], `手续费 ${formatPct(result.params.fee * 100)}，滑点 ${formatPct(result.params.slippage * 100)}，单次使用 ${Math.round(result.params.risk * 100)}% 现金。`] : strategyNotes[params.strategy]} />
            <Notes title="最新信号" items={latestNotes} />
          </div>
        </div>

        <section className="table-shell table-section">
          <div className="shell-head">
            <h3>交易记录</h3>
            <button className="ghost" type="button" onClick={restoreSample}>
              清空导入
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>动作</th>
                  <th>价格</th>
                  <th>数量 BTC</th>
                  <th>现金</th>
                  <th>权益</th>
                  <th>单笔收益</th>
                </tr>
              </thead>
              <tbody>
                {result && result.trades.length ? (
                  result.trades.map((trade, index) => (
                    <tr key={`${trade.date}-${trade.action}-${index}`}>
                      <td>{trade.date}</td>
                      <td>
                        <span className={`tag ${trade.action === "BUY" ? "buy" : "sell"}`}>{trade.action}</span>
                      </td>
                      <td>{formatUsd(trade.price)}</td>
                      <td>{formatNum(trade.qty, 6)}</td>
                      <td>{formatUsd(trade.cash)}</td>
                      <td>{formatUsd(trade.equity)}</td>
                      <td className={trade.pnl == null ? "" : trade.pnl >= 0 ? "positive" : "negative"}>
                        {trade.pnl == null ? "-" : formatUsd(trade.pnl)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty" colSpan={7}>
                      当前参数没有产生交易。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} step={step} value={formatInputValue(value)} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function Notes({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="notes">
      <div className="shell-head">
        <h3>{title}</h3>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function formatInputValue(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString();
}
