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
};

export type MarketSignal = {
  price: number;
  macd: number;
  signal: number;
  bias: "bullish" | "bearish" | "neutral";
  ready: boolean;
};

type MarketConsoleProps = {
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";

function formatPrice(price: number) {
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export function MarketConsole({ onMarketSignal, onFeedStatus }: MarketConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const indicatorRef = useRef<IndicatorState>({ fast: null, slow: null, signal: null, ticks: 0 });
  const previousPriceRef = useRef<number | null>(null);

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
        const previousPrice = previousPriceRef.current;
        previousPriceRef.current = price;
        const state = indicatorRef.current;
        state.fast = state.fast === null ? price : state.fast + (2 / 13) * (price - state.fast);
        state.slow = state.slow === null ? price : state.slow + (2 / 27) * (price - state.slow);
        const macd = state.fast - state.slow;
        state.signal = state.signal === null ? macd : state.signal + (2 / 10) * (macd - state.signal);
        state.ticks += 1;
        const ready = state.ticks >= 26;
        const bias = macd > state.signal ? "Bullish" : macd < state.signal ? "Bearish" : "Neutral";
        onMarketSignal?.({
          price,
          macd,
          signal: state.signal,
          bias: bias.toLowerCase() as MarketSignal["bias"],
          ready,
        });

        const priceDirection = previousPrice === null || price === previousPrice
          ? "price-neutral"
          : price > previousPrice ? "price-up" : "price-down";
        const analysisLevel = bias.toLowerCase() as "bullish" | "bearish" | "neutral";
        appendEntry(`${MARKET_SYMBOL} ${formatPrice(price)}`, priceDirection, quote.DT);
        appendEntry(
          `MACD ${macd.toFixed(5)} / signal ${state.signal.toFixed(5)} · ${bias}${ready ? "" : " · warming up"}`,
          analysisLevel,
          quote.DT,
        );
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
