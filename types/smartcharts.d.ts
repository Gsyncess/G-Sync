declare module "@deriv-com/smartcharts-champion" {
  type SmartChartProps = {
    id?: string;
    symbol?: string;
    isMobile?: boolean;
    isLive?: boolean;
    isConnectionOpened?: boolean;
    chartType?: string;
    granularity?: number;
    chartData?: {
      activeSymbols?: unknown[];
      tradingTimes?: Record<string, { isOpen: boolean; openTime: string; closeTime: string }>;
    };
    feedCall?: { activeSymbols?: boolean; tradingTimes?: boolean };
    getQuotes: (request: import("@/lib/deriv-smartchart-transport").DerivHistoryRequest) => Promise<unknown>;
    subscribeQuotes: (
      request: import("@/lib/deriv-smartchart-transport").DerivSubscriptionRequest,
      callback: (quote: import("@/lib/deriv-smartchart-transport").SmartChartQuote) => void,
    ) => () => void;
    unsubscribeQuotes: (request: { symbol?: string; ticks_history?: string; granularity?: number }) => void;
    topWidgets?: () => import("react").ReactNode;
    toolbarWidget?: () => import("react").ReactNode;
    chartControlsWidgets?: () => import("react").ReactNode;
    enabledChartFooter?: boolean;
    isAnimationEnabled?: boolean;
    isVerticalScrollEnabled?: boolean;
  };

  type ChartModeProps = {
    onChartType?: (chartType?: string) => void;
    onGranularity?: (granularity: number) => void;
  };

  export const SmartChart: import("react").ComponentType<SmartChartProps>;
  export const ChartTitle: import("react").ComponentType<{
    onChange?: (symbol: string) => void;
    isNestedList?: boolean;
  }>;
  export const ChartMode: import("react").ComponentType<ChartModeProps>;
  export const ChartSetting: import("react").ComponentType;
  export const StudyLegend: import("react").ComponentType;
  export const Views: import("react").ComponentType<ChartModeProps>;
  export const DrawTools: import("react").ComponentType;
  export const Share: import("react").ComponentType;
  export const ToolbarWidget: import("react").ComponentType<{ children?: import("react").ReactNode }>;
  export function setSmartChartsPublicPath(path: string): void;
}
