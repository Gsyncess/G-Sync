export type DerivMarketSubscriptionRequest = {
  symbol: string;
  granularity: number;
};

export type DerivMarketCandle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  DT: Date;
};

type DerivResponse = {
  req_id?: number;
  subscription?: { id?: string };
  echo_req?: Record<string, unknown>;
  candles?: Array<Record<string, unknown>>;
  ohlc?: Record<string, unknown>;
  error?: { message?: string };
};

type Subscription = {
  request: DerivMarketSubscriptionRequest;
  callbacks: Set<(candle: DerivMarketCandle, historical: boolean) => void>;
  id?: string;
  openingGeneration?: number;
};

type PendingRequest = {
  resolve: (response: DerivResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
  subscriptionKey?: string;
};

const subscriptionKey = (request: { symbol?: string; ticks_history?: string; granularity?: number }) => {
  const symbol = request.symbol ?? request.ticks_history ?? "";
  return request.granularity ? `${symbol}:${request.granularity}` : symbol;
};

const DERIV_PUBLIC_WEBSOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";

function normalizeCandle(value: Record<string, unknown>): DerivMarketCandle | null {
  const epoch = Number(value.epoch);
  const open = Number(value.open);
  const high = Number(value.high);
  const low = Number(value.low);
  const close = Number(value.close);
  if (
    !Number.isFinite(epoch) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    high < low
  ) return null;
  return { epoch, open, high, low, close, DT: new Date(epoch * 1000) };
}

export class DerivMarketTransport {
  private socket: WebSocket | null = null;
  private nextRequestId = 1;
  private reconnectDelay = 1000;
  private reconnectTimer: number | undefined;
  private closed = false;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, Subscription>();
  private opening: Promise<void> | null = null;
  private connectionGeneration = 0;
  private isLive = false;

  constructor(
    private readonly onStatus: (status: "Connecting" | "Live" | "Reconnecting" | "Unavailable") => void,
    private readonly onError: (error: Error) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    this.isLive = false;
    this.onStatus(this.socket ? "Reconnecting" : "Connecting");
    const generation = ++this.connectionGeneration;
    this.opening = new Promise((resolve) => {
      const socket = new WebSocket(DERIV_PUBLIC_WEBSOCKET);
      this.socket = socket;
      socket.onopen = () => {
        if (this.closed || this.socket !== socket) {
          socket.close();
          return;
        }
        this.reconnectDelay = 1000;
        resolve();
        this.subscriptions.forEach((subscription, key) => {
          void this.openSubscription(key, subscription, generation);
        });
      };
      socket.onmessage = (event) => {
        if (this.socket === socket) this.handleMessage(String(event.data));
      };
      socket.onerror = () => {
        if (this.socket === socket) this.onStatus("Reconnecting");
      };
      socket.onclose = () => {
        resolve();
        if (this.socket !== socket) return;
        this.socket = null;
        this.isLive = false;
        this.subscriptions.forEach((subscription) => {
          subscription.id = undefined;
          subscription.openingGeneration = undefined;
        });
        if (this.closed) return;
        this.onStatus("Reconnecting");
        this.pending.forEach(({ reject: rejectRequest, timeout }) => {
          window.clearTimeout(timeout);
          rejectRequest(new Error("Deriv connection closed."));
        });
        this.pending.clear();
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = undefined;
          this.connect();
        }, this.reconnectDelay);
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
    const pendingRequest = requestId === undefined ? undefined : this.pending.get(requestId);
    if (requestId !== undefined) {
      if (pendingRequest) {
        window.clearTimeout(pendingRequest.timeout);
        this.pending.delete(requestId);
        pendingRequest.resolve(response);
      }
    }

    const requestEcho = response.echo_req ?? {};
    const subscriptionId = response.subscription?.id;
    const matchingSubscription = subscriptionId
      ? [...this.subscriptions.entries()].find(([, candidate]) => candidate.id === subscriptionId)
      : undefined;
    const echoedSymbol = [
      requestEcho.ticks,
      requestEcho.ticks_history,
      requestEcho.symbol,
    ].find((value): value is string => typeof value === "string");
    const key = matchingSubscription?.[0]
      ?? (echoedSymbol
        ? subscriptionKey({
            symbol: echoedSymbol,
            granularity: typeof requestEcho.granularity === "number" ? requestEcho.granularity : undefined,
          })
        : undefined)
      ?? pendingRequest?.subscriptionKey;
    if (!key) return;
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    if (subscriptionId) subscription.id = subscriptionId;

    const candles = response.candles?.flatMap((candle) => {
      const normalized = normalizeCandle(candle);
      return normalized ? [normalized] : [];
    }) ?? [];
    candles.forEach((candle) => {
      subscription.callbacks.forEach((callback) => callback(candle, true));
    });
    const currentCandle = response.ohlc ? normalizeCandle(response.ohlc) : null;
    if (currentCandle) {
      subscription.callbacks.forEach((callback) => callback(currentCandle, false));
      if (!this.isLive) {
        this.isLive = true;
        this.onStatus("Live");
      }
    }
    if (candles.length > 0 && !this.isLive) {
      this.isLive = true;
      this.onStatus("Live");
    }
  }

  private async send(
    request: Record<string, unknown>,
    generation: number,
    requestSubscriptionKey?: string,
  ): Promise<DerivResponse> {
    if (this.connectionGeneration !== generation) {
      throw new Error("Deriv connection changed before the request was sent.");
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      await this.opening;
    }
    const socket = this.socket;
    if (
      this.connectionGeneration !== generation ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new Error("Deriv connection is not available.");
    }

    const reqId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Deriv request timed out."));
      }, 15000);
      this.pending.set(reqId, { resolve, reject, timeout, subscriptionKey: requestSubscriptionKey });
      try {
        socket.send(JSON.stringify({ ...request, req_id: reqId }));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(reqId);
        reject(error instanceof Error ? error : new Error("Could not send the Deriv request."));
      }
    });
  }

  private async openSubscription(key: string, subscription: Subscription, generation = this.connectionGeneration) {
    if (
      subscription.openingGeneration === generation ||
      subscription.id ||
      this.closed
    ) return;
    subscription.openingGeneration = generation;
    const request = subscription.request;
    try {
      const response = await this.send({
        ticks_history: request.symbol,
        end: "latest",
        count: 100,
        style: "candles",
        granularity: request.granularity,
        subscribe: 1,
      }, generation, key);
      if (response.error) throw new Error(response.error.message ?? "Deriv subscription failed.");
      if (this.connectionGeneration !== generation) return;
      if (this.subscriptions.get(key) === subscription) {
        subscription.id = response.subscription?.id;
        this.reconnectDelay = 1000;
      } else if (response.subscription?.id) {
        void this.send({ forget: response.subscription.id }, generation).catch((error: unknown) => {
          this.onError(error instanceof Error ? error : new Error("Could not close the market subscription."));
        });
      }
    } catch (error) {
      if (this.connectionGeneration !== generation || this.closed) return;
      subscription.openingGeneration = undefined;
      this.onStatus("Unavailable");
      this.onError(error instanceof Error ? error : new Error("Deriv market subscription failed."));
      const retryDelay = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
      window.setTimeout(() => {
        if (this.closed || this.subscriptions.get(key) !== subscription) return;
        if (this.socket?.readyState === WebSocket.OPEN) {
          void this.openSubscription(key, subscription);
        } else if (
          this.reconnectTimer === undefined &&
          (!this.socket || this.socket.readyState === WebSocket.CLOSED)
        ) {
          this.connect();
        }
      }, retryDelay);
    }
  }

  subscribeCandles(
    request: DerivMarketSubscriptionRequest,
    callback: (candle: DerivMarketCandle, historical: boolean) => void,
  ) {
    const key = subscriptionKey(request);
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = { request, callbacks: new Set() };
      this.subscriptions.set(key, subscription);
    }
    subscription.callbacks.add(callback);
    if (this.socket?.readyState === WebSocket.OPEN) {
      void this.openSubscription(key, subscription);
    }

    return () => {
      const current = this.subscriptions.get(key);
      if (!current) return;
      current.callbacks.delete(callback);
      if (current.callbacks.size === 0) this.forget(key);
    };
  }

  private forget(key: string) {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    this.subscriptions.delete(key);
    if (subscription.id) {
      void this.send({ forget: subscription.id }, this.connectionGeneration).catch((error: unknown) => {
        this.onError(error instanceof Error ? error : new Error("Could not close the market subscription."));
      });
    }
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
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