"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { DerivMarketTransport, type DerivMarketQuote } from "@/lib/deriv-market-transport";

type ConsoleEntry = {
  id: number;
  time: string;
  message: string;
  level: "info" | "price-up" | "price-down" | "price-neutral" | "bullish" | "bearish" | "neutral" | "error";
};

type IndicatorState = {
  prices: number[];
  ticks: number;
  previousDpo: number | null;
  lastTickIdentity: string | null;
};

export type MarketSignal = {
  price: number;
  dpo: number;
  bias: "bullish" | "bearish" | "neutral";
  ready: boolean;
  crossover: "CALL" | "PUT" | null;
};

type MarketConsoleProps = {
  showAnalysis: boolean;
  idleMessage: string;
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";
const SCAN_INTERVAL = 5;
const DPO_PERIOD = 14;
const DPO_SHIFT = Math.floor(DPO_PERIOD / 2) + 1;
const DPO_WARMUP_TICKS = DPO_PERIOD + DPO_SHIFT;
const MARKET_WINDOW_TICKS = 20;

export function MarketConsole({ showAnalysis, idleMessage, onMarketSignal, onFeedStatus }: MarketConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const showAnalysisRef = useRef(showAnalysis);
  showAnalysisRef.current = showAnalysis;
  const indicatorRef = useRef<IndicatorState>({
    prices: [],
    ticks: 0,
    previousDpo: null,
    lastTickIdentity: null,
  });

  useEffect(() => {
    let active = true;
    const appendEntry = (message: string, level: ConsoleEntry["level"] = "info", time = new Date()) => {
      if (!active || !showAnalysisRef.current) return;
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
            prices: [],
            ticks: 0,
            previousDpo: null,
            lastTickIdentity: null,
          };
          onMarketSignal?.({
            price: 0,
            dpo: 0,
            bias: "neutral",
            ready: false,
            crossover: null,
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
        const tickEpoch = quote.tick?.epoch;
        // Deriv's tick.id identifies the subscription, so deduplicate using the actual quote timestamp and price.
        const tickIdentity = `${String(tickEpoch ?? quote.Date)}:${price}`;
        if (state.lastTickIdentity === tickIdentity) return;
        state.lastTickIdentity = tickIdentity;
        state.prices.push(price);
        if (state.prices.length > DPO_WARMUP_TICKS) state.prices.shift();
        state.ticks += 1;
        const ready = state.prices.length >= DPO_WARMUP_TICKS;
        const dpoSmaEnd = state.prices.length - DPO_SHIFT;
        const dpoSmaStart = dpoSmaEnd - DPO_PERIOD;
        const dpoSma = ready
          ? state.prices.slice(dpoSmaStart, dpoSmaEnd).reduce((sum, value) => sum + value, 0) / DPO_PERIOD
          : null;
        const dpo = dpoSma === null ? 0 : price - dpoSma;
        const crossover = ready && state.previousDpo !== null && state.previousDpo <= 0 && dpo > 0
          ? "CALL"
          : ready && state.previousDpo !== null && state.previousDpo >= 0 && dpo < 0
            ? "PUT"
            : null;
        if (ready) state.previousDpo = dpo;
        const bias = dpo > 0 ? "bullish" : dpo < 0 ? "bearish" : "neutral";

        if (state.ticks % SCAN_INTERVAL === 0) {
          const marketWindow = state.prices.slice(-MARKET_WINDOW_TICKS);
          const support = Math.min(...marketWindow);
          const resistance = Math.max(...marketWindow);
          const range = resistance - support;
          const proximity = Math.max(range * 0.2, Math.abs(price) * 0.0001);
          const supportState = price - support <= proximity ? "support nearby" : "support below";
          const resistanceState = resistance - price <= proximity ? "resistance nearby" : "resistance overhead";
          const momentumStart = marketWindow[Math.max(0, marketWindow.length - 6)];
          const momentumThreshold = Math.max(Math.abs(price) * 0.00005, Number.EPSILON);
          const momentum = price - momentumStart > momentumThreshold
            ? "bullish momentum"
            : momentumStart - price > momentumThreshold
              ? "bearish momentum"
              : "sideways momentum";
          appendEntry(
            ready
              ? `Volatility 100 scan · ${bias} bias · ${momentum} · ${supportState} · ${resistanceState} · DPO ${bias}`
              : `Volatility 100 scan · collecting one-tick DPO history · ${Math.min(state.ticks, DPO_WARMUP_TICKS)}/${DPO_WARMUP_TICKS} ticks`,
            ready ? bias : "info",
            quote.DT,
          );
        }

        onMarketSignal?.({
          price,
          dpo,
          bias,
          ready,
          crossover,
        });

        if (ready && crossover) {
          appendEntry(
            `DPO ${crossover === "CALL" ? "bullish" : "bearish"} crossover · ${crossover === "CALL" ? "RISE" : "FALL"} signal`,
            crossover === "CALL" ? "bullish" : "bearish",
            quote.DT,
          );
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
    if (!showAnalysis) setEntries([]);
  }, [showAnalysis]);

  useEffect(() => {
    entriesRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <section className="market-console-panel" aria-label="Live market and analysis console">
      {showAnalysis ? (
        <div className="market-console-output" ref={entriesRef} role="log" aria-label="Market feed and analysis log" aria-live="off">
          {entries.length === 0 ? (
            <p className="market-console-empty">Waiting for live market analysis…</p>
          ) : entries.map((entry) => (
            <div className={`market-console-entry market-console-${entry.level}`} key={entry.id}>
              <time>{entry.time}</time>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="market-console-idle" role="status">
          <span className="market-console-idle-icon"><Activity size={20} aria-hidden="true" /></span>
          <p>{idleMessage}</p>
        </div>
      )}
    </section>
  );
}
