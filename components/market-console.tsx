"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { DerivMarketTransport, type DerivMarketCandle } from "@/lib/deriv-market-transport";
import {
  DEFAULT_STRATEGY_CONFIG,
  evaluateDerivStrategy,
  type DerivCandle,
} from "@/lib/deriv-strategy";

export type MarketConsoleCategory = "system" | "success" | "monitoring" | "signal" | "warning" | "error" | "paused";

type ConsoleEntry = {
  id: number;
  time: string;
  message: string;
  category: MarketConsoleCategory;
  label: string;
};

type CandleState = {
  closedCandles: DerivCandle[];
  currentCandle: DerivCandle | null;
  lastSignalEpoch: number | null;
};

export type MarketSignal = {
  ready: boolean;
  crossover: "CALL" | "PUT" | null;
  candleEpoch: number | null;
};

export type MarketConsoleEvent = {
  id: number;
  message: string;
  category: MarketConsoleCategory;
  label: string;
};

type MarketConsoleProps = {
  showAnalysis: boolean;
  idleMessage: string;
  tradeEvents?: MarketConsoleEvent[];
  onMarketSignal?: (signal: MarketSignal) => void;
  onFeedStatus?: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";
const CANDLE_GRANULARITY_SECONDS = 60;

function toStrategyCandle(candle: DerivMarketCandle): DerivCandle {
  return {
    epoch: candle.epoch,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

export function MarketConsole({
  showAnalysis,
  idleMessage,
  tradeEvents = [],
  onMarketSignal,
  onFeedStatus,
}: MarketConsoleProps) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const showAnalysisRef = useRef(showAnalysis);
  showAnalysisRef.current = showAnalysis;
  const newestEntry = entries[0];
  const newestEntryId = newestEntry?.id;
  const newestEntryMessage = newestEntry?.message;
  const [typedCharacterCount, setTypedCharacterCount] = useState(0);
  const candleStateRef = useRef<CandleState>({
    closedCandles: [],
    currentCandle: null,
    lastSignalEpoch: null,
  });
  const feedStatusRef = useRef<"Connecting" | "Live" | "Reconnecting" | "Unavailable">("Connecting");
  const engineInitializedRef = useRef(false);
  const loggedTradeEventIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    const appendEntry = (
      message: string,
      category: MarketConsoleCategory,
      label: string,
      time = new Date(),
    ) => {
      if (!active || !showAnalysisRef.current) return;
      const entry: ConsoleEntry = {
        id: nextIdRef.current++,
        time: time.toLocaleTimeString(),
        message,
        category,
        label,
      };
      setEntries((current) => [entry, ...current.slice(0, MAX_CONSOLE_ENTRIES - 1)]);
    };

    appendEntry("Trading engine initialized", "system", "SYSTEM");
    const transport = new DerivMarketTransport(
      (status) => {
        if (!active) return;
        feedStatusRef.current = status;
        if (status === "Reconnecting" || status === "Unavailable") {
          candleStateRef.current = {
            closedCandles: [],
            currentCandle: null,
            lastSignalEpoch: null,
          };
          onMarketSignal?.({ ready: false, crossover: null, candleEpoch: null });
        }
        onFeedStatus?.(status);
        if (status === "Live") {
          appendEntry("Deriv connection established", "success", "CONNECTED");
        } else if (status === "Reconnecting") {
          appendEntry("Trading temporarily paused", "paused", "PAUSED");
        } else if (status === "Unavailable") {
          appendEntry("Market data is currently unavailable", "error", "ERROR");
        }
      },
      (error) => appendEntry(error.message, "error", "ERROR"),
    );

    const unsubscribe = transport.subscribeCandles(
      { symbol: MARKET_SYMBOL, granularity: CANDLE_GRANULARITY_SECONDS },
      (incomingCandle, historical) => {
        if (!active) return;
        const candle = toStrategyCandle(incomingCandle);
        const state = candleStateRef.current;
        if (historical) {
          if (state.currentCandle && candle.epoch <= state.currentCandle.epoch) return;
          if (state.currentCandle) {
            state.closedCandles.push(state.currentCandle);
          }
          state.currentCandle = candle;
          state.closedCandles = state.closedCandles.slice(-120);
          return;
        }

        if (!state.currentCandle) {
          state.currentCandle = candle;
          return;
        }
        if (candle.epoch < state.currentCandle.epoch) return;
        if (candle.epoch === state.currentCandle.epoch) {
          state.currentCandle = candle;
          return;
        }

        state.closedCandles.push(state.currentCandle);
        state.closedCandles = state.closedCandles.slice(-120);
        state.currentCandle = candle;
        const latestClosedCandle = state.closedCandles[state.closedCandles.length - 1];
        if (!latestClosedCandle) return;

        appendEntry("Market conditions evaluated", "monitoring", "MONITOR", incomingCandle.DT);
        appendEntry("Monitoring market activity", "monitoring", "MONITOR", incomingCandle.DT);
        const signal = evaluateDerivStrategy(state.closedCandles, DEFAULT_STRATEGY_CONFIG);
        const crossover = signal?.candleEpoch === latestClosedCandle.epoch
          ? signal.contractType
          : null;
        onMarketSignal?.({
          ready: state.closedCandles.length >= DEFAULT_STRATEGY_CONFIG.slowEmaPeriod,
          crossover,
          candleEpoch: crossover ? latestClosedCandle.epoch : null,
        });
        if (crossover && state.lastSignalEpoch !== latestClosedCandle.epoch) {
          state.lastSignalEpoch = latestClosedCandle.epoch;
          appendEntry("Trading opportunity detected", "signal", "SIGNAL", incomingCandle.DT);
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
    if (!showAnalysis) {
      engineInitializedRef.current = false;
      setEntries([]);
      return;
    }
    if (engineInitializedRef.current) return;
    engineInitializedRef.current = true;
    const time = new Date().toLocaleTimeString();
    const startupEntries: ConsoleEntry[] = [{
      id: nextIdRef.current++,
      time,
      message: "Trading engine initialized",
      category: "system",
      label: "SYSTEM",
    }];
    if (feedStatusRef.current === "Live") {
      startupEntries.push({
        id: nextIdRef.current++,
        time,
        message: "Deriv connection established",
        category: "success",
        label: "CONNECTED",
      });
    }
    setEntries((current) => [...startupEntries.reverse(), ...current].slice(0, MAX_CONSOLE_ENTRIES));
  }, [showAnalysis]);

  useEffect(() => {
    const newEvents = tradeEvents
      .filter((event) => event.id > loggedTradeEventIdRef.current)
      .sort((left, right) => left.id - right.id);
    if (newEvents.length === 0) return;
    loggedTradeEventIdRef.current = newEvents[newEvents.length - 1].id;
    if (!showAnalysis) return;
    const entriesToAdd = newEvents.map((event) => ({
      ...event,
      time: new Date().toLocaleTimeString(),
    })).reverse();
    setEntries((current) => [...entriesToAdd, ...current].slice(0, MAX_CONSOLE_ENTRIES));
  }, [showAnalysis, tradeEvents]);

  useEffect(() => {
    if (newestEntryMessage === undefined) {
      setTypedCharacterCount(0);
      return;
    }
    let typedCharacters = 0;
    setTypedCharacterCount(0);
    const timerId = window.setInterval(() => {
      typedCharacters = Math.min(typedCharacters + 1, newestEntryMessage.length);
      setTypedCharacterCount(typedCharacters);
      if (typedCharacters >= newestEntryMessage.length) window.clearInterval(timerId);
    }, 18);
    return () => window.clearInterval(timerId);
  }, [newestEntryId, newestEntryMessage]);

  useEffect(() => {
    entriesRef.current?.scrollTo({ top: 0 });
  }, [entries]);

  return (
    <section className="market-console-panel" aria-label="Live market and analysis console">
      {showAnalysis ? (
        <div className="market-console-output" ref={entriesRef} role="log" aria-label="Trading activity" aria-live="off">
          {entries.length === 0 ? (
            <p className="market-console-empty">Waiting for live market activity…</p>
          ) : entries.map((entry, index) => (
            <div className={`market-console-entry market-console-${entry.category}`} key={entry.id}>
              <span className="market-console-entry-marker" aria-hidden="true" />
              <time>{entry.time}</time>
              <strong>{entry.label}</strong>
              <span className="market-console-entry-message">
                {index === 0 ? entry.message.slice(0, typedCharacterCount) : entry.message}
                {index === 0 && typedCharacterCount < entry.message.length && (
                  <span className="market-console-cursor" aria-hidden="true" />
                )}
              </span>
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
