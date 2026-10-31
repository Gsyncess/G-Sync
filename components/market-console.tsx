"use client";

import { useEffect, useRef, useState } from "react";
import { DerivMarketTransport, type DerivMarketQuote } from "@/lib/deriv-market-transport";

type ConsoleEntry = {
  id: number;
  time: string;
  message: string;
  level: "info" | "price-up" | "price-down" | "price-neutral" | "bullish" | "bearish" | "neutral" | "error";
};

type BreakoutState = {
  prices: number[];
  ticks: number;
  previousPrice: number | null;
  lastTickIdentity: string | null;
};

export type MarketSignal = {
  price: number;
  ready: boolean;
  tradeSignal: "CALL" | "PUT" | null;
};

type MarketConsoleProps = {
  isBotRunning: boolean;
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";
const SCAN_INTERVAL = 20;
const BREAKOUT_LOOKBACK_TICKS = 30;

export function MarketConsole({ isBotRunning, onMarketSignal, onFeedStatus }: MarketConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const isBotRunningRef = useRef(isBotRunning);
  isBotRunningRef.current = isBotRunning;
  const recentEntryRef = useRef<{ key: string; timestamp: number } | null>(null);
  const breakoutRef = useRef<BreakoutState>({
    prices: [],
    ticks: 0,
    previousPrice: null,
    lastTickIdentity: null,
  });

  useEffect(() => {
    let active = true;
    const appendEntry = (message: string, level: ConsoleEntry["level"] = "info", time = new Date()) => {
      if (!active || !isBotRunningRef.current) return;
      const key = `${level}:${message}`;
      const now = Date.now();
      if (recentEntryRef.current?.key === key && now - recentEntryRef.current.timestamp < 1000) return;
      recentEntryRef.current = { key, timestamp: now };
      const entry: ConsoleEntry = {
        id: nextIdRef.current++,
        time: time.toLocaleTimeString(),
        message,
        level,
      };
      setEntries((current) => [entry, ...current.slice(0, MAX_CONSOLE_ENTRIES - 1)]);
    };

    const transport = new DerivMarketTransport(
      (status) => {
        if (!active) return;
        if (status === "Reconnecting" || status === "Unavailable") {
          breakoutRef.current = {
            prices: [],
            ticks: 0,
            previousPrice: null,
            lastTickIdentity: null,
          };
          onMarketSignal?.({
            price: 0,
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
        const state = breakoutRef.current;
        const tickId = quote.tick?.id;
        const tickEpoch = quote.tick?.epoch;
        const tickIdentity = tickId !== undefined
          ? String(tickId)
          : `${String(tickEpoch ?? quote.Date)}:${price}`;
        if (state.lastTickIdentity === tickIdentity) return;
        state.lastTickIdentity = tickIdentity;
        state.ticks += 1;
        const ready = state.prices.length >= BREAKOUT_LOOKBACK_TICKS;
        const rangeHigh = ready ? Math.max(...state.prices) : null;
        const rangeLow = ready ? Math.min(...state.prices) : null;
        const tradeSignal = ready && state.previousPrice !== null && rangeHigh !== null && rangeLow !== null
          ? state.previousPrice <= rangeHigh && price > rangeHigh
            ? "CALL"
            : state.previousPrice >= rangeLow && price < rangeLow
              ? "PUT"
              : null
          : null;
        state.prices.push(price);
        if (state.prices.length > BREAKOUT_LOOKBACK_TICKS) state.prices.shift();
        state.previousPrice = price;

        if (ready && state.ticks % SCAN_INTERVAL === 0) {
          appendEntry(`Market scan · ${MARKET_SYMBOL} · looking for opportunities`, "info", quote.DT);
        }

        onMarketSignal?.({
          price,
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
    if (!isBotRunning) return;
    const logMarketStatus = () => {
      const message = `${MARKET_SYMBOL} · bot running · scanning for breakouts`;
      const key = `info:${message}`;
      const now = Date.now();
      if (recentEntryRef.current?.key === key && now - recentEntryRef.current.timestamp < 900) return;
      recentEntryRef.current = { key, timestamp: now };
      const entry: ConsoleEntry = {
        id: nextIdRef.current++,
        time: new Date(now).toLocaleTimeString(),
        message,
        level: "info",
      };
      setEntries((current) => [entry, ...current.slice(0, MAX_CONSOLE_ENTRIES - 1)]);
    };
    logMarketStatus();
    const intervalId = window.setInterval(logMarketStatus, 1000);
    return () => window.clearInterval(intervalId);
  }, [isBotRunning]);

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
