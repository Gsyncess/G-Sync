"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Wifi } from "lucide-react";
import {
  DerivSmartChartTransport,
  type DerivHistoryRequest,
  type DerivSubscriptionRequest,
  type SmartChartQuote,
} from "@/lib/deriv-smartchart-transport";

type SmartChartsModule = typeof import("@deriv-com/smartcharts-champion");

type MarketChartData = {
  activeSymbols?: unknown[];
  tradingTimes?: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
};

type DerivActiveSymbol = {
  exchange_is_open: number;
  display_name: string;
  market: string;
  market_display_name: string;
  pip: number;
  subgroup: string;
  subgroup_display_name: string;
  submarket: string;
  submarket_display_name: string;
  symbol: string;
  symbol_type: string;
};

function displayMarketName(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeActiveSymbols(symbols: unknown[]): DerivActiveSymbol[] {
  return symbols.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const symbol = item as {
      exchange_is_open?: unknown;
      market?: unknown;
      pip_size?: unknown;
      subgroup?: unknown;
      submarket?: unknown;
      underlying_symbol?: unknown;
      underlying_symbol_name?: unknown;
      underlying_symbol_type?: unknown;
    };
    if (
      typeof symbol.underlying_symbol !== "string" ||
      typeof symbol.underlying_symbol_name !== "string" ||
      typeof symbol.underlying_symbol_type !== "string" ||
      typeof symbol.market !== "string" ||
      typeof symbol.subgroup !== "string" ||
      typeof symbol.submarket !== "string" ||
      typeof symbol.pip_size !== "number"
    ) {
      return [];
    }

    return [{
      exchange_is_open: symbol.exchange_is_open === 1 ? 1 : 0,
      display_name: symbol.underlying_symbol_name,
      market: symbol.market,
      market_display_name: displayMarketName(symbol.market),
      pip: symbol.pip_size,
      subgroup: symbol.subgroup,
      subgroup_display_name: displayMarketName(symbol.subgroup),
      submarket: symbol.submarket,
      submarket_display_name: displayMarketName(symbol.submarket),
      symbol: symbol.underlying_symbol,
      symbol_type: symbol.underlying_symbol_type,
    }];
  });
}

export function DerivSmartChart() {
  const [sdk, setSdk] = useState<SmartChartsModule | null>(null);
  const [chartData, setChartData] = useState<MarketChartData | null>(null);
  const [marketStatus, setMarketStatus] = useState("Connecting");
  const [marketError, setMarketError] = useState("");
  const [symbol] = useState("R_100");
  const [chartType, setChartType] = useState("mountain");
  const [granularity, setGranularity] = useState<number | undefined>(60);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const transportRef = useRef<DerivSmartChartTransport | null>(null);

  useEffect(() => {
    let active = true;
    void import("@deriv-com/smartcharts-champion")
      .then((module) => {
        module.setSmartChartsPublicPath("/smartcharts/");
        if (active) setSdk(module);
      })
      .catch((error: unknown) => {
        if (active) {
          setMarketError(error instanceof Error ? error.message : "Could not load Deriv SmartCharts.");
          setMarketStatus("Unavailable");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const transport = new DerivSmartChartTransport(
      (status) => {
        if (!active) return;
        setMarketStatus(status);
        setConnectionOpen(status === "Live");
      },
      (error) => {
        if (!active) return;
        setMarketError(error.message);
      },
    );
    transportRef.current = transport;

    void Promise.all([
      transport.requestAPI({ active_symbols: "brief" }),
      transport.requestAPI({ trading_times: "today" }),
    ])
      .then(([symbolsResponse, timesResponse]) => {
        if (!active) return;
        const tradingTimes: NonNullable<MarketChartData["tradingTimes"]> = {};
        const now = new Date();
        const datePrefix = now.toISOString().slice(0, 11);
        for (const market of timesResponse.trading_times?.markets ?? []) {
          const submarkets = market.submarkets;
          if (!Array.isArray(submarkets)) continue;
          for (const submarket of submarkets) {
            if (typeof submarket !== "object" || submarket === null) continue;
            const marketSymbols = (submarket as { symbols?: unknown }).symbols;
            if (!Array.isArray(marketSymbols)) continue;
            for (const item of marketSymbols) {
              if (typeof item !== "object" || item === null) continue;
              const { symbol: itemSymbol, times } = item as {
                symbol?: string;
                underlying_symbol?: string;
                times?: { open?: string[]; close?: string[] };
              };
              const symbolCode = itemSymbol ?? (item as { underlying_symbol?: string }).underlying_symbol;
              if (!symbolCode || !times) continue;
              const open = times.open?.[0] ?? "--";
              const close = times.close?.[0] ?? "--";
              const openTime = open === "--" ? "" : `${datePrefix}${open}Z`;
              const closeTime = close === "--" ? "" : `${datePrefix}${close}Z`;
              const openDate = openTime ? new Date(openTime) : null;
              const closeDate = closeTime ? new Date(closeTime) : null;
              tradingTimes[symbolCode] = {
                isOpen: open === "00:00:00" && close === "23:59:59"
                  ? true
                  : open !== "--" && close !== "--" && Boolean(openDate && closeDate && now >= openDate && now < closeDate),
                openTime,
                closeTime,
              };
            }
          }
        }
        const activeSymbols = normalizeActiveSymbols(symbolsResponse.active_symbols ?? []);
        setChartData({
          activeSymbols,
          tradingTimes,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMarketError(error instanceof Error ? error.message : "Could not load Deriv market data.");
        setMarketStatus("Unavailable");
      });

    return () => {
      active = false;
      transportRef.current = null;
      transport.close();
    };
  }, []);

  const getQuotes = useCallback((request: DerivHistoryRequest) => {
    if (!transportRef.current) return Promise.reject(new Error("Deriv connection is not ready."));
    return transportRef.current.getQuotes(request);
  }, []);

  const subscribeQuotes = useCallback(
    (request: DerivSubscriptionRequest, callback: (quote: SmartChartQuote) => void) =>
      transportRef.current?.subscribeQuotes(request, callback) ?? (() => undefined),
    [],
  );

  const unsubscribeQuotes = useCallback(
    (request: { symbol?: string; ticks_history?: string; granularity?: number }) => {
      transportRef.current?.unsubscribeQuotes(request);
    },
    [],
  );

  const handleChartType = useCallback((nextChartType?: string) => {
    if (nextChartType) setChartType(nextChartType);
  }, []);

  const renderTopWidgets = useCallback(() => null, []);

  const renderToolbar = useCallback(() => {
    if (!sdk) return null;
    return (
      <sdk.ToolbarWidget>
        <sdk.ChartMode onChartType={handleChartType} onGranularity={setGranularity} />
        <sdk.StudyLegend />
        <sdk.Views onChartType={handleChartType} onGranularity={setGranularity} />
        <sdk.DrawTools />
        <sdk.Share />
      </sdk.ToolbarWidget>
    );
  }, [handleChartType, sdk]);

  const renderChartSettings = useCallback(() => sdk ? <sdk.ChartSetting /> : null, [sdk]);

  if (marketError) {
    return (
      <div className="smartchart-placeholder" role="status">
        <span className="chart-empty-icon"><Activity size={19} /></span>
        <strong>Deriv chart unavailable</strong>
        <span>{marketError}</span>
      </div>
    );
  }

  if (!sdk || !chartData) {
    return (
      <div className="smartchart-placeholder" role="status">
        <span className="chart-empty-icon"><Wifi size={19} /></span>
        <strong>{marketStatus === "Unavailable" ? "Deriv market data unavailable" : "Connecting to Deriv"}</strong>
        <span>Loading live market chart and available symbols.</span>
      </div>
    );
  }

  return (
    <div className="smartchart-instance" aria-label="Deriv SmartCharts live market chart">
      <sdk.SmartChart
        id="gsync-deriv-smartchart"
        symbol={symbol}
        isMobile
        isLive
        isConnectionOpened={connectionOpen}
        chartType={chartType}
        granularity={granularity}
        chartData={chartData}
        feedCall={{ activeSymbols: false, tradingTimes: false }}
        getQuotes={getQuotes}
        subscribeQuotes={subscribeQuotes}
        unsubscribeQuotes={unsubscribeQuotes}
        topWidgets={renderTopWidgets}
        toolbarWidget={renderToolbar}
        chartControlsWidgets={renderChartSettings}
        enabledChartFooter
        isAnimationEnabled={false}
        isVerticalScrollEnabled={false}
      />
    </div>
  );
}

export default dynamic(() => Promise.resolve(DerivSmartChart), {
  ssr: false,
});