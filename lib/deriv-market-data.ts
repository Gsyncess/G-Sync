import WebSocket from "ws";
import type { DerivCandle } from "./deriv-strategy";

const DERIV_PUBLIC_WEBSOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";

export async function fetchRecentDerivCandles(
  symbol: string,
  count = 100,
): Promise<DerivCandle[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_PUBLIC_WEBSOCKET, { handshakeTimeout: 10_000 });
    const timeout = setTimeout(() => {
      finish(new Error("Deriv candle history request timed out."));
    }, 15_000);
    let settled = false;

    const finish = (error?: Error, candles?: DerivCandle[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close();
      if (error) reject(error);
      else resolve(candles ?? []);
    };

    socket.on("open", () => {
      socket.send(JSON.stringify({
        ticks_history: symbol,
        end: "latest",
        count,
        style: "candles",
        granularity: 60,
        req_id: 1,
      }));
    });

    socket.on("message", (payload) => {
      let response: unknown;
      try {
        response = JSON.parse(payload.toString());
      } catch {
        finish(new Error("Deriv returned invalid candle history."));
        return;
      }
      if (!response || typeof response !== "object") return;
      const result = response as {
        req_id?: unknown;
        candles?: unknown;
        error?: { message?: unknown };
      };
      if (result.req_id !== 1) return;
      if (result.error) {
        finish(new Error(
          typeof result.error.message === "string"
            ? result.error.message
            : "Could not load market candle history.",
        ));
        return;
      }
      if (!Array.isArray(result.candles)) {
        finish(new Error("Deriv returned no candle history."));
        return;
      }
      const candles = result.candles.flatMap((item): DerivCandle[] => {
        if (!item || typeof item !== "object") return [];
        const candle = item as Record<string, unknown>;
        const epoch = Number(candle.epoch);
        const open = Number(candle.open);
        const high = Number(candle.high);
        const low = Number(candle.low);
        const close = Number(candle.close);
        if (
          !Number.isSafeInteger(epoch) ||
          ![open, high, low, close].every(Number.isFinite) ||
          high < low
        ) return [];
        return [{ epoch, open, high, low, close }];
      });
      finish(undefined, candles);
    });

    socket.on("error", () => finish(new Error("Could not connect to Deriv market data.")));
    socket.on("close", () => {
      if (!settled) finish(new Error("Deriv market data disconnected before returning candle history."));
    });
  });
}
