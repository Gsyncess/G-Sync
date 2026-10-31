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
  lastTickIdentity: string | null;
};

export type MarketSignal = {
  price: number;
  macd: number;
  signal: number;
  bias: "bullish" | "bearish" | "neutral";
  ready: boolean;
  tradeSignal: "CALL" | "PUT" | null;
};

type MarketConsoleProps = {
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";
const SCAN_INTERVAL = 20;
const INDICATOR_WARMUP_TICKS = 35;

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
    lastTickIdentity: null,
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
        if (status === "Reconnecting" || status === "Unavailable") {
          indicatorRef.current = {
            fast: null,
            slow: null,
            signal: null,
            ticks: 0,
            previousHistogram: null,
            lastTickIdentity: null,
          };
          onMarketSignal?.({
            price: 0,
            macd: 0,
            signal: 0,
            bias: "neutral",
            ready: false,
            tradeSignal: null,
          });
        }
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
        const tickId = quote.tick?.id;
        const tickEpoch = quote.tick?.epoch;
        const tickIdentity = tickId !== undefined
          ? String(tickId)
          : `${String(tickEpoch ?? quote.Date)}:${price}`;
        if (state.lastTickIdentity === tickIdentity) return;
        state.lastTickIdentity = tickIdentity;
        state.fast = state.fast === null ? price : state.fast + (2 / 13) * (price - state.fast);
        state.slow = state.slow === null ? price : state.slow + (2 / 27) * (price - state.slow);
        const macd = state.fast - state.slow;
        state.signal = state.signal === null ? macd : state.signal + (2 / 10) * (macd - state.signal);
        state.ticks += 1;
        const ready = state.ticks >= INDICATOR_WARMUP_TICKS;
        const histogram = macd - state.signal;
        const tradeSignal = !ready
          ? null
          : state.ticks === INDICATOR_WARMUP_TICKS
            ? histogram > 0 ? "CALL" : histogram < 0 ? "PUT" : null
            : state.previousHistogram !== null && state.previousHistogram <= 0 && histogram > 0
              ? "CALL"
              : state.previousHistogram !== null && state.previousHistogram >= 0 && histogram < 0
                ? "PUT"
                : null;
        state.previousHistogram = histogram;
        const bias = histogram > 0 ? "bullish" : histogram < 0 ? "bearish" : "neutral";

        if (ready && state.ticks % SCAN_INTERVAL === 0) {
          appendEntry(`Market scan · ${MARKET_SYMBOL} · looking for opportunities`, "info", quote.DT);
        }

        onMarketSignal?.({
          price,
          macd,
          signal: state.signal,
          bias,
          ready,
          tradeSignal,
        });

        if (ready && tradeSignal) {
          appendEntry(`Signal · ${tradeSignal === "CALL" ? "BUY" : "SELL"}`, tradeSignal === "CALL" ? "bullish" : "bearish", quote.DT);
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
