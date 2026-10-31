"use client";

import { useEffect, useRef, useState } from "react";
import { DerivMarketTransport, type DerivMarketQuote } from "@/lib/deriv-market-transport";

type ConsoleEntry = {
  id: number;
  time: string;
  message: string;
  level: "info" | "price-up" | "price-down" | "price-neutral" | "bullish" | "bearish" | "neutral" | "error";
};

type IndicatorState = {
  fast: number | null;
  slow: number | null;
  signal: number | null;
  ticks: number;
  previousHistogram: number | null;
  prices: number[];
  lastSupport: number | null;
  lastResistance: number | null;
  lastSupportTick: number;
  lastResistanceTick: number;
};

export type MarketSignal = {
  price: number;
  macd: number;
  signal: number;
  bias: "bullish" | "bearish" | "neutral";
  ready: boolean;
  crossover: "CALL" | "PUT" | null;
};

type MarketConsoleProps = {
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";
const ANALYSIS_WINDOW = 40;
const SCAN_INTERVAL = 20;

export function MarketConsole({ onMarketSignal, onFeedStatus }: MarketConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const indicatorRef = useRef<IndicatorState>({
    fast: null,
    slow: null,
    signal: null,
    ticks: 0,
    previousHistogram: null,
    prices: [],
    lastSupport: null,
    lastResistance: null,
    lastSupportTick: 0,
    lastResistanceTick: 0,
  });

  useEffect(() => {
    let active = true;
    const appendEntry = (message: string, level: ConsoleEntry["level"] = "info", time = new Date()) => {
      if (!active) return;
      const entry: ConsoleEntry = {
        id: nextIdRef.current++,
        time: time.toLocaleTimeString(),
        message,
        level,
      };
      setEntries((current) => [entry, ...current.slice(0, MAX_CONSOLE_ENTRIES - 1)]);
    };

    appendEntry(`Connecting to the public ${MARKET_SYMBOL} market feed.`);
    const transport = new DerivMarketTransport(
      (status) => {
        if (!active) return;
        onFeedStatus?.(status);
        appendEntry(
          status === "Live"
            ? "Public market feed connected."
            : `Market feed ${status.toLowerCase()}.`,
          status === "Unavailable" ? "error" : "info",
        );
      },
      (error) => appendEntry(error.message, "error"),
    );

    const unsubscribe = transport.subscribeMarket(
      { symbol: MARKET_SYMBOL },
      (quote: DerivMarketQuote) => {
        const price = quote.Close;
        const state = indicatorRef.current;
        state.fast = state.fast === null ? price : state.fast + (2 / 13) * (price - state.fast);
        state.slow = state.slow === null ? price : state.slow + (2 / 27) * (price - state.slow);
        const macd = state.fast - state.slow;
        state.signal = state.signal === null ? macd : state.signal + (2 / 10) * (macd - state.signal);
        state.ticks += 1;
        const ready = state.ticks >= 26;
        const histogram = macd - state.signal;
        const crossover = state.previousHistogram !== null && state.previousHistogram <= 0 && histogram > 0
          ? "CALL"
          : state.previousHistogram !== null && state.previousHistogram >= 0 && histogram < 0
            ? "PUT"
            : null;
        state.previousHistogram = histogram;
        const bias = histogram > 0 ? "bullish" : histogram < 0 ? "bearish" : "neutral";
        state.prices.push(price);
        if (state.prices.length > ANALYSIS_WINDOW) state.prices.shift();

        if (ready && state.ticks % SCAN_INTERVAL === 0) {
          appendEntry(`Market scan · ${MARKET_SYMBOL} · looking for opportunities`, "info", quote.DT);
        }

        if (ready && state.prices.length === ANALYSIS_WINDOW && state.ticks % 8 === 0) {
          const support = Math.min(...state.prices);
          const resistance = Math.max(...state.prices);
          const levelThreshold = Math.max(price * 0.0001, 0.01);
          if (
            (state.lastSupport === null || Math.abs(support - state.lastSupport) >= levelThreshold) &&
            state.ticks - state.lastSupportTick >= 8
          ) {
            appendEntry("Support · zone identified", "neutral", quote.DT);
            state.lastSupport = support;
            state.lastSupportTick = state.ticks;
          }
          if (
            (state.lastResistance === null || Math.abs(resistance - state.lastResistance) >= levelThreshold) &&
            state.ticks - state.lastResistanceTick >= 8
          ) {
            appendEntry("Resistance · zone identified", "neutral", quote.DT);
            state.lastResistance = resistance;
            state.lastResistanceTick = state.ticks;
          }
        }

        onMarketSignal?.({
          price,
          macd,
          signal: state.signal,
          bias,
          ready,
          crossover,
        });

        if (ready && crossover) {
          appendEntry(`Signal · ${crossover} opportunity`, crossover === "CALL" ? "bullish" : "bearish", quote.DT);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
      transport.close();
    };
  }, [onFeedStatus, onMarketSignal]);

  useEffect(() => {
    entriesRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <section className="market-console-panel" aria-label="Live market and analysis console">
      <div className="market-console-output" ref={entriesRef} role="log" aria-label="Market feed and analysis log" aria-live="off">
        {entries.length === 0 ? (
          <p className="market-console-empty">Waiting for market updates…</p>
        ) : entries.map((entry) => (
          <div className={`market-console-entry market-console-${entry.level}`} key={entry.id}>
            <time>{entry.time}</time>
            <span>{entry.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
