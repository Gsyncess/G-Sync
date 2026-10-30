"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Wifi } from "lucide-react";
import {
  DerivSmartChartTransport,
  type DerivHistoryRequest,
  type DerivSubscriptionRequest,
  type SmartChartQuote,
} from "@/lib/deriv-smartchart-transport";

type SmartChartsModule = typeof import("@deriv-com/smartcharts-champion");

const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID?.trim();

type MarketChartData = {
  activeSymbols?: unknown[];
  tradingTimes?: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
};

export function DerivSmartChart() {
  const [sdk, setSdk] = useState<SmartChartsModule | null>(null);
  const [chartData, setChartData] = useState<MarketChartData | null>(null);
  const [marketStatus, setMarketStatus] = useState("App ID required");
  const [marketError, setMarketError] = useState("");
  const [symbol, setSymbol] = useState("R_100");
  const [chartType, setChartType] = useState("mountain");
  const [granularity, setGranularity] = useState<number | undefined>(60);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const transportRef = useRef<DerivSmartChartTransport | null>(null);

  useEffect(() => {
    let active = true;
    void import("@deriv-com/smartcharts-champion")
      .then((loaded) => {
        loaded.setSmartChartsPublicPath("/smartcharts/");
        if (active) setSdk(loaded);
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
    if (!DERIV_APP_ID) {
      setMarketStatus("App ID required");
      return;
    }

    let active = true;
    const transport = new DerivSmartChartTransport(DERIV_APP_ID, (status) => {
      if (!active) return;
      setMarketStatus(status);
      setConnectionOpen(status === "Live");
    });
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
                times?: { open?: string[]; close?: string[] };
              };
              if (!itemSymbol || !times) continue;
              const open = times.open?.[0] ?? "--";
              const close = times.close?.[0] ?? "--";
              const openTime = open === "--" ? "" : `${datePrefix}${open}Z`;
              const closeTime = close === "--" ? "" : `${datePrefix}${close}Z`;
              const openDate = openTime ? new Date(openTime) : null;
              const closeDate = closeTime ? new Date(closeTime) : null;
              tradingTimes[itemSymbol] = {
                isOpen: open === "00:00:00" && close === "23:59:59"
                  ? true
                  : Boolean(openDate && closeDate && now >= openDate && now < closeDate),
                openTime,
                closeTime,
              };
            }
          }
        }
        setChartData({
          activeSymbols: symbolsResponse.active_symbols,
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

  const renderTopWidgets = useCallback(() => {
    if (!sdk) return null;
    return <sdk.ChartTitle onChange={setSymbol} isNestedList />;
  }, [sdk]);

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

  if (!DERIV_APP_ID) {
    return (
      <div className="smartchart-placeholder" role="status">
        <span className="chart-empty-icon"><Wifi size={19} /></span>
        <strong>Deriv SmartCharts is ready to connect</strong>
        <span>Set NEXT_PUBLIC_DERIV_APP_ID in your app environment to load the live chart.</span>
      </div>
    );
  }

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
        <strong>{marketStatus === "Live" ? "Loading Deriv SmartCharts" : "Connecting to Deriv"}</strong>
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