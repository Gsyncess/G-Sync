export type DerivHistoryRequest = {
  symbol: string;
  granularity?: number;
  count?: number;
  start?: number;
  end?: number;
  style?: string;
};

export type DerivSubscriptionRequest = {
  symbol: string;
  granularity?: number;
  style?: string;
};

export type SmartChartQuote = {
  Date: string;
  Close: number;
  Open?: number;
  High?: number;
  Low?: number;
  DT: Date;
  tick?: Record<string, unknown>;
  ohlc?: Record<string, unknown>;
};

type DerivResponse = {
  req_id?: number;
  subscription?: { id?: string };
  echo_req?: Record<string, unknown>;
  candles?: Array<{ open: string; high: string; low: string; close: string; epoch: number }>;
  history?: { prices: string[]; times: number[] };
  tick?: { quote: number; epoch: number; [key: string]: unknown };
  ohlc?: {
    open: string;
    high: string;
    low: string;
    close: string;
    open_time: number;
    [key: string]: unknown;
  };
  active_symbols?: unknown[];
  trading_times?: { markets?: Array<Record<string, unknown>> };
  error?: { message?: string };
};

type Subscription = {
  request: DerivSubscriptionRequest;
  callbacks: Set<(quote: SmartChartQuote) => void>;
  id?: string;
};

type PendingRequest = {
  resolve: (response: DerivResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const subscriptionKey = (request: { symbol?: string; ticks_history?: string; granularity?: number }) =>
  `${request.symbol ?? request.ticks_history ?? ""}:${request.granularity ?? 0}`;

const DERIV_PUBLIC_WEBSOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";

export class DerivSmartChartTransport {
  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private reconnectDelay = 1000;
  private reconnectTimer: number | undefined;
  private closed = false;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, Subscription>();
  private opening: Promise<void> | null = null;

  constructor(
    private readonly onStatus: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void,
    private readonly onError: (error: Error) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    this.onStatus(this.socket ? "Reconnecting" : "Connecting");
    this.opening = new Promise((resolve, reject) => {
      const socket = new WebSocket(DERIV_PUBLIC_WEBSOCKET);
      this.socket = socket;
      socket.onopen = () => {
        this.reconnectDelay = 1000;
        this.onStatus("Live");
        resolve();
        this.subscriptions.forEach((subscription, key) => {
          void this.openSubscription(key, subscription);
        });
      };
      socket.onmessage = (event) => this.handleMessage(String(event.data));
      socket.onerror = () => this.onStatus("Reconnecting");
      socket.onclose = () => {
        reject(new Error("Deriv connection closed."));
        if (this.closed) return;
        this.onStatus("Reconnecting");
        this.pending.forEach(({ reject: rejectRequest, timeout }) => {
          window.clearTimeout(timeout);
          rejectRequest(new Error("Deriv connection closed."));
        });
        this.pending.clear();
        this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      };
    });
  }

  private handleMessage(payload: string) {
    let response: DerivResponse;
    try {
      response = JSON.parse(payload) as DerivResponse;
    } catch {
      this.onStatus("Unavailable");
      return;
    }

    const requestId = response.req_id;
    if (requestId !== undefined) {
      const pendingRequest = this.pending.get(requestId);
      if (pendingRequest) {
        window.clearTimeout(pendingRequest.timeout);
        this.pending.delete(requestId);
        pendingRequest.resolve(response);
      }
    }

    const requestEcho = response.echo_req ?? {};
    const key = subscriptionKey({
      symbol: typeof requestEcho.ticks_history === "string" ? requestEcho.ticks_history : undefined,
      ticks_history: typeof requestEcho.ticks_history === "string" ? requestEcho.ticks_history : undefined,
      granularity: typeof requestEcho.granularity === "number" ? requestEcho.granularity : undefined,
    });
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    if (response.subscription?.id) subscription.id = response.subscription.id;

    if (response.tick) {
      const date = new Date(response.tick.epoch * 1000);
      const quote: SmartChartQuote = {
        Date: date.toISOString(),
        Close: response.tick.quote,
        DT: date,
        tick: response.tick,
      };
      subscription.callbacks.forEach((callback) => callback(quote));
    } else if (response.ohlc) {
      const date = new Date(response.ohlc.open_time * 1000);
      const quote: SmartChartQuote = {
        Date: date.toISOString(),
        Open: Number(response.ohlc.open),
        High: Number(response.ohlc.high),
        Low: Number(response.ohlc.low),
        Close: Number(response.ohlc.close),
        DT: date,
        ohlc: response.ohlc,
      };
      subscription.callbacks.forEach((callback) => callback(quote));
    }
  }

  private async send(request: Record<string, unknown>): Promise<DerivResponse> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.opening;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Deriv connection is not available.");
    }

    const reqId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Deriv request timed out."));
      }, 15000);
      this.pending.set(reqId, { resolve, reject, timeout });
      this.socket?.send(JSON.stringify({ ...request, req_id: reqId }));
    });
  }

  async requestAPI(request: Record<string, unknown>) {
    const response = await this.send(request);
    if (response.error) throw new Error(response.error.message ?? "Deriv request failed.");
    return response;
  }

  async getQuotes(request: DerivHistoryRequest) {
    const response = await this.requestAPI({
      ticks_history: request.symbol,
      style: request.style ?? (request.granularity ? "candles" : "ticks"),
      count: request.count ?? 500,
      end: request.end ? String(request.end) : "latest",
      adjust_start_time: 1,
      ...(request.granularity ? { granularity: request.granularity } : {}),
      ...(request.start ? { start: String(request.start) } : {}),
    });

    return {
      ...(response.candles
        ? {
            candles: response.candles.map((candle) => ({
              open: Number(candle.open),
              high: Number(candle.high),
              low: Number(candle.low),
              close: Number(candle.close),
              epoch: Number(candle.epoch),
            })),
          }
        : {}),
      ...(response.history
        ? {
            history: {
              prices: response.history.prices.map(Number),
              times: response.history.times.map(Number),
            },
          }
        : {}),
    };
  }

  private async openSubscription(key: string, subscription: Subscription) {
    const request = subscription.request;
    try {
      const response = await this.send({
        ticks_history: request.symbol,
        style: request.style ?? (request.granularity ? "candles" : "ticks"),
        subscribe: 1,
        adjust_start_time: 1,
        count: 1,
        end: "latest",
        ...(request.granularity ? { granularity: request.granularity } : {}),
      });
      if (response.error) throw new Error(response.error.message ?? "Deriv subscription failed.");
      if (this.subscriptions.get(key) === subscription) {
        subscription.id = response.subscription?.id;
      } else if (response.subscription?.id) {
        void this.requestAPI({ forget: response.subscription.id }).catch(() => undefined);
      }
    } catch (error) {
      this.onStatus("Unavailable");
      this.onError(error instanceof Error ? error : new Error("Deriv market subscription failed."));
    }
  }

  subscribeQuotes(request: DerivSubscriptionRequest, callback: (quote: SmartChartQuote) => void) {
    const key = subscriptionKey(request);
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = { request, callbacks: new Set() };
      this.subscriptions.set(key, subscription);
      void this.openSubscription(key, subscription);
    }
    subscription.callbacks.add(callback);

    return () => {
      const current = this.subscriptions.get(key);
      if (!current) return;
      current.callbacks.delete(callback);
      if (current.callbacks.size === 0) this.forget(key);
    };
  }

  unsubscribeQuotes(request: { symbol?: string; ticks_history?: string; granularity?: number }) {
    this.forget(subscriptionKey(request));
  }

  private forget(key: string) {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    this.subscriptions.delete(key);
    if (subscription.id) {
      void this.requestAPI({ forget: subscription.id }).catch(() => undefined);
    }
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.pending.forEach(({ reject, timeout }) => {
      window.clearTimeout(timeout);
      reject(new Error("Deriv connection was closed."));
    });
    this.pending.clear();
    this.subscriptions.clear();
    this.socket?.close();
    this.socket = null;
  }
}