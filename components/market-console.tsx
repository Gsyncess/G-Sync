"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { DerivMarketTransport, type DerivMarketQuote } from "@/lib/deriv-market-transport";

type ConsoleEntry = {
  id: number;
  time: string;
  message: string;
  level: "info" | "market" | "analysis" | "error";
};

type IndicatorState = {
  fast: number | null;
  slow: number | null;
  signal: number | null;
};

const MAX_CONSOLE_ENTRIES = 100;
const MARKET_SYMBOL = "R_100";

function formatPrice(price: number) {
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 });
}

export function MarketConsole() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const entriesRef = useRef<HTMLDivElement>(null);
  const nextIdRef = useRef(0);
  const indicatorRef = useRef<IndicatorState>({ fast: null, slow: null, signal: null });

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
      setEntries((current) => [...current.slice(-(MAX_CONSOLE_ENTRIES - 1)), entry]);
    };

    appendEntry(`Connecting to the public ${MARKET_SYMBOL} market feed.`);
    const transport = new DerivMarketTransport(
      (status) => {
        if (!active) return;
        setConnectionStatus(status);
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
        const bias = macd > state.signal ? "Bullish" : macd < state.signal ? "Bearish" : "Neutral";

        appendEntry(`${MARKET_SYMBOL} ${formatPrice(price)}`, "market", quote.DT);
        appendEntry(
          `MACD ${macd.toFixed(5)} / signal ${state.signal.toFixed(5)} · ${bias}`,
          "analysis",
          quote.DT,
        );
      },
    );

    return () => {
      active = false;
      unsubscribe();
      transport.close();
    };
  }, []);

  useEffect(() => {
    entriesRef.current?.scrollTo({ top: entriesRef.current.scrollHeight });
  }, [entries]);

  return (
    <section className="market-console-panel" aria-label="Live market and analysis console">
      <header className="market-console-header">
        <div className="market-console-title">
          <span className="market-console-icon"><Terminal size={18} /></span>
          <div>
            <h2>Market console</h2>
            <p>Volatility 100 · live market and MACD analysis · read-only</p>
          </div>
        </div>
        <div className="market-console-actions">
          <span className="market-console-status">
            <span className={`status-dot ${connectionStatus === "Live" ? "status-dot-live" : ""}`} />
            {connectionStatus}
          </span>
          <button type="button" className="market-console-clear" onClick={() => setEntries([])} aria-label="Clear console">
            <Trash2 size={15} />
            <span>Clear</span>
          </button>
        </div>
      </header>
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
      <footer className="market-console-footer">
        Public Deriv market data · Analysis is informational and does not place trades.
      </footer>
    </section>
  );
}
