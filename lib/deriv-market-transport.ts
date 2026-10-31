export type DerivMarketSubscriptionRequest = {
  symbol: string;
};

export type DerivMarketQuote = {
  Date: string;
  Close: number;
  DT: Date;
  tick?: Record<string, unknown>;
};

type DerivResponse = {
  req_id?: number;
  subscription?: { id?: string };
  echo_req?: Record<string, unknown>;
  tick?: { quote: number; epoch: number; [key: string]: unknown };
  error?: { message?: string };
};

type Subscription = {
  request: DerivMarketSubscriptionRequest;
  callbacks: Set<(quote: DerivMarketQuote) => void>;
  id?: string;
};

type PendingRequest = {
  resolve: (response: DerivResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const subscriptionKey = (request: { symbol?: string; ticks_history?: string }) =>
  request.symbol ?? request.ticks_history ?? "";

const DERIV_PUBLIC_WEBSOCKET = "wss://api.derivws.com/trading/v1/options/ws/public";

export class DerivMarketTransport {
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
    });
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    if (response.subscription?.id) subscription.id = response.subscription.id;

    if (response.tick) {
      const date = new Date(response.tick.epoch * 1000);
      const quote: DerivMarketQuote = {
        Date: date.toISOString(),
        Close: response.tick.quote,
        DT: date,
        tick: response.tick,
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

  private async openSubscription(key: string, subscription: Subscription) {
    const request = subscription.request;
    try {
      const response = await this.send({
        ticks_history: request.symbol,
        style: "ticks",
        subscribe: 1,
        adjust_start_time: 1,
        count: 1,
        end: "latest",
      });
      if (response.error) throw new Error(response.error.message ?? "Deriv subscription failed.");
      if (this.subscriptions.get(key) === subscription) {
        subscription.id = response.subscription?.id;
      } else if (response.subscription?.id) {
        void this.send({ forget: response.subscription.id }).catch((error: unknown) => {
          this.onError(error instanceof Error ? error : new Error("Could not close the market subscription."));
        });
      }
    } catch (error) {
      this.onStatus("Unavailable");
      this.onError(error instanceof Error ? error : new Error("Deriv market subscription failed."));
    }
  }

  subscribeMarket(request: DerivMarketSubscriptionRequest, callback: (quote: DerivMarketQuote) => void) {
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

  private forget(key: string) {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    this.subscriptions.delete(key);
    if (subscription.id) {
      void this.send({ forget: subscription.id }).catch((error: unknown) => {
        this.onError(error instanceof Error ? error : new Error("Could not close the market subscription."));
      });
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