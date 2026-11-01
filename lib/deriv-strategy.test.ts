import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDerivStrategy, type DerivCandle } from "./deriv-strategy";

function createCandles(closes: number[], pivotIndex: number, pivot: "lower" | "upper"): DerivCandle[] {
  return closes.map((close, index) => ({
    epoch: index * 60,
    open: close,
    high: pivot === "upper" && index === pivotIndex ? close + 20 : close + 2,
    low: pivot === "lower" && index === pivotIndex ? close - 20 : close - 2,
    close,
  }));
}

test("signals a rise only after an EMA cross with a confirmed lower fractal", () => {
  const closes = [...Array(20).fill(100), 90, 80, 85, 87, 90, 95, 120];
  assert.deepEqual(
    evaluateDerivStrategy(createCandles(closes, 21, "lower")),
    { contractType: "CALL", candleEpoch: (closes.length - 1) * 60 },
  );
});

test("signals a fall only after an EMA cross with a confirmed upper fractal", () => {
  const closes = [...Array(20).fill(100), 110, 120, 115, 113, 110, 105, 80];
  assert.deepEqual(
    evaluateDerivStrategy(createCandles(closes, 21, "upper")),
    { contractType: "PUT", candleEpoch: (closes.length - 1) * 60 },
  );
});

test("does not use a fractal before two candles confirm it", () => {
  const closes = [...Array(20).fill(100), 90, 80, 140];
  assert.equal(evaluateDerivStrategy(createCandles(closes, 21, "lower")), null);
});

test("rejects an invalid internal strategy configuration", () => {
  assert.equal(
    evaluateDerivStrategy([], {
      fastEmaPeriod: 14,
      slowEmaPeriod: 5,
      fractalSideBars: 2,
      maxFractalAgeCandles: 5,
    }),
    null,
  );
});
