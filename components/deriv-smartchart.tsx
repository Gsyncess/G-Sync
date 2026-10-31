"use client";

import dynamic from "next/dynamic";
import { Component, type ErrorInfo, type ReactNode } from "react";

const DerivSmartChart = dynamic(
  () => import("@/components/deriv-smartchart-client").then((module) => module.DerivSmartChart),
  { ssr: false },
);

type ChartErrorBoundaryState = {
  error: Error | null;
};

class ChartErrorBoundary extends Component<{ children: ReactNode }, ChartErrorBoundaryState> {
  state: ChartErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Deriv SmartChart failed to render.", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="smartchart-placeholder" role="alert">
          <strong>Deriv chart unavailable</strong>
          <span>{this.state.error.message}</span>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function DerivSmartChartWithBoundary() {
  return (
    <ChartErrorBoundary>
      <DerivSmartChart />
    </ChartErrorBoundary>
  );
}
