export type DerivCandle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type StrategyConfig = {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  fractalSideBars: number;
  maxFractalAgeCandles: number;
};

export type StrategySignal = {
  contractType: "CALL" | "PUT";
  candleEpoch: number;
};

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  fastEmaPeriod: 5,
  slowEmaPeriod: 14,
  fractalSideBars: 2,
  maxFractalAgeCandles: 5,
};

function calculateEmaSeries(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;

  const seedIndex = period - 1;
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[seedIndex] = ema;
  const smoothing = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    ema = values[index] * smoothing + ema * (1 - smoothing);
    result[index] = ema;
  }
  return result;
}

function hasConfirmedFractal(
  candles: DerivCandle[],
  index: number,
  sideBars: number,
  direction: "lower" | "upper",
) {
  const pivot = candles[index];
  for (let offset = 1; offset <= sideBars; offset += 1) {
    const left = candles[index - offset];
    const right = candles[index + offset];
    if (!left || !right) return false;
    if (
      direction === "lower"
        ? pivot.low >= left.low || pivot.low >= right.low
        : pivot.high <= left.high || pivot.high <= right.high
    ) return false;
  }
  return true;
}

function hasRecentConfirmedFractal(
  candles: DerivCandle[],
  signalIndex: number,
  config: StrategyConfig,
  direction: "lower" | "upper",
) {
  const newestConfirmedIndex = signalIndex - config.fractalSideBars;
  const oldestIndex = Math.max(
    config.fractalSideBars,
    signalIndex - config.maxFractalAgeCandles - config.fractalSideBars,
  );
  for (let index = newestConfirmedIndex; index >= oldestIndex; index -= 1) {
    if (hasConfirmedFractal(candles, index, config.fractalSideBars, direction)) return true;
  }
  return false;
}

export function evaluateDerivStrategy(
  candles: DerivCandle[],
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
): StrategySignal | null {
  if (
    !Number.isInteger(config.fastEmaPeriod) ||
    !Number.isInteger(config.slowEmaPeriod) ||
    !Number.isInteger(config.fractalSideBars) ||
    !Number.isInteger(config.maxFractalAgeCandles) ||
    config.fastEmaPeriod < 2 ||
    config.slowEmaPeriod <= config.fastEmaPeriod ||
    config.fractalSideBars < 1 ||
    config.maxFractalAgeCandles < 0
  ) return null;

  const validCandles = candles.filter((candle) =>
    Number.isFinite(candle.epoch) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.high >= candle.low,
  );
  const minimumCandles = Math.max(
    config.slowEmaPeriod + 1,
    config.fractalSideBars * 2 + 2,
  );
  if (validCandles.length < minimumCandles) return null;

  const closes = validCandles.map((candle) => candle.close);
  const fastEma = calculateEmaSeries(closes, config.fastEmaPeriod);
  const slowEma = calculateEmaSeries(closes, config.slowEmaPeriod);
  const signalIndex = validCandles.length - 1;
  const previousIndex = signalIndex - 1;
  const previousFast = fastEma[previousIndex];
  const previousSlow = slowEma[previousIndex];
  const currentFast = fastEma[signalIndex];
  const currentSlow = slowEma[signalIndex];
  if (
    previousFast === null ||
    previousSlow === null ||
    currentFast === null ||
    currentSlow === null
  ) return null;

  const crossedUp = previousFast <= previousSlow && currentFast > currentSlow;
  const crossedDown = previousFast >= previousSlow && currentFast < currentSlow;
  if (
    crossedUp &&
    hasRecentConfirmedFractal(validCandles, signalIndex, config, "lower")
  ) {
    return { contractType: "CALL", candleEpoch: validCandles[signalIndex].epoch };
  }
  if (
    crossedDown &&
    hasRecentConfirmedFractal(validCandles, signalIndex, config, "upper")
  ) {
    return { contractType: "PUT", candleEpoch: validCandles[signalIndex].epoch };
  }
  return null;
}
