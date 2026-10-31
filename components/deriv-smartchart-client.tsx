"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Wifi } from "lucide-react";
import {
  ChartMode,
  ChartTitle,
  DrawTools,
  Share,
  setSmartChartsPublicPath,
  SmartChart,
  StudyLegend,
  ToolbarWidget,
  Views,
} from "@deriv-com/smartcharts-champion";
import {
  DerivSmartChartTransport,
  type DerivHistoryRequest,
  type DerivSubscriptionRequest,
  type SmartChartQuote,
} from "@/lib/deriv-smartchart-transport";

setSmartChartsPublicPath("/smartcharts/");

type MarketChartData = {
  activeSymbols?: unknown[];
  tradingTimes?: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
};

type DerivActiveSymbol = {
  exchange_is_open: number;
  is_trading_suspended: number;
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
      is_trading_suspended?: unknown;
      market?: unknown;
      pip_size?: unknown;
      subgroup?: unknown;
      submarket?: unknown;
      underlying_symbol?: unknown;
      underlying_symbol_name?: unknown;
      underlying_symbol_type?: unknown;
    };
    if (typeof symbol.underlying_symbol !== "string") return [];

    const market = typeof symbol.market === "string" ? symbol.market : "";
    const subgroup = typeof symbol.subgroup === "string" ? symbol.subgroup : "";
    const submarket = typeof symbol.submarket === "string" ? symbol.submarket : "";

    return [{
      exchange_is_open: symbol.exchange_is_open === 1 ? 1 : 0,
      is_trading_suspended: symbol.is_trading_suspended === 1 ? 1 : 0,
      display_name: typeof symbol.underlying_symbol_name === "string"
        ? symbol.underlying_symbol_name
        : symbol.underlying_symbol,
      market,
      market_display_name: displayMarketName(market),
      pip: typeof symbol.pip_size === "number" ? symbol.pip_size : 0.01,
      subgroup,
      subgroup_display_name: displayMarketName(subgroup),
      submarket,
      submarket_display_name: displayMarketName(submarket),
      symbol: symbol.underlying_symbol,
      symbol_type: typeof symbol.underlying_symbol_type === "string" ? symbol.underlying_symbol_type : "",
    }];
  });
}

export function DerivSmartChart() {
  const [chartData, setChartData] = useState<MarketChartData | null>(null);
  const [marketStatus, setMarketStatus] = useState("Connecting");
  const [marketError, setMarketError] = useState("");
  const [symbol, setSymbol] = useState("R_100");
  const [chartType, setChartType] = useState<string | undefined>("line");
  const [granularity, setGranularity] = useState(60);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [isReadyToMount, setIsReadyToMount] = useState(false);
  const transportRef = useRef<DerivSmartChartTransport | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(
          registrations
            .filter((registration) => registration.active?.scriptURL.includes("flutter_service_worker"))
            .map((registration) => registration.unregister()),
        ))
        .catch((error: unknown) => {
          console.warn("[DerivSmartChart] Could not unregister a stale chart service worker.", error);
        });
    }

    setIsReadyToMount(true);
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
        for (const activeSymbol of activeSymbols) {
          if (!tradingTimes[activeSymbol.symbol]) {
            tradingTimes[activeSymbol.symbol] = {
              isOpen: activeSymbol.exchange_is_open === 1,
              openTime: "",
              closeTime: "",
            };
          }
        }
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

  const renderToolbar = useCallback(() => {
    return (
      <ToolbarWidget>
        <ChartMode onChartType={setChartType} onGranularity={setGranularity} />
        <StudyLegend />
        <Views onChartType={setChartType} onGranularity={setGranularity} />
        <DrawTools />
        <Share />
      </ToolbarWidget>
    );
  }, []);

  const renderTopWidgets = useCallback(
    () => <ChartTitle onChange={setSymbol} />,
    [],
  );

  if (marketError) {
    return (
      <div className="smartchart-placeholder" role="status">
        <span className="chart-empty-icon"><Activity size={19} /></span>
        <strong>Deriv chart unavailable</strong>
        <span>{marketError}</span>
      </div>
    );
  }

  if (!chartData || !isReadyToMount) {
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
      <SmartChart
        key={symbol}
        id="gsync-deriv-smartchart"
        symbol={symbol}
        isMobile
        isLive
        isConnectionOpened={connectionOpen}
        chartType={chartType}
        granularity={granularity}
        chartData={chartData}
        getQuotes={getQuotes}
        subscribeQuotes={subscribeQuotes}
        unsubscribeQuotes={unsubscribeQuotes}
        topWidgets={renderTopWidgets}
        toolbarWidget={renderToolbar}
        chartControlsWidgets={null}
        chartStatusListener={() => {}}
        stateChangeListener={() => {}}
        drawingToolFloatingMenuPosition={{ x: 100, y: 100 }}
        clearChart={false}
        enabledChartFooter={false}
        enabledNavigationWidget={false}
        maxTick={24}
        onSettingsChange={() => {}}
        settings={{
          language: "en",
          isHighestLowestMarkerEnabled: false,
          theme: "light",
        }}
        isVerticalScrollEnabled={false}
      />
    </div>
  );
}