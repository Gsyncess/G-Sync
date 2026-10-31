"use client";

import dynamic from "next/dynamic";

const DerivSmartChart = dynamic(
  () => import("@/components/deriv-smartchart-client").then((module) => module.DerivSmartChart),
  { ssr: false },
);

export default DerivSmartChart;
