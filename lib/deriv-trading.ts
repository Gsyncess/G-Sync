import WebSocket from "ws";

export class DerivTradeError extends Error {
  constructor(
    message: string,
    readonly tradeMayBeOpen = false,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DerivTradeError";
  }
}

type TradeOptions = {
  accessToken: string;
  accountId: string;
  accountType: "demo" | "real";
  contractType: "CALL" | "PUT";
  currency: string;
  stake: number;
  onPurchased?: (purchase: { stake: number; payout: number }) => void;
  onProgress?: (progress: { ticksPassed: number; totalTicks: number }) => void;
};

type DerivMessage = {
  msg_type?: string;
  error?: { code?: string; message?: string };
  balance?: {
    balance?: unknown;
    currency?: unknown;
    loginid?: unknown;
  };
  proposal?: { id?: unknown; ask_price?: unknown };
  buy?: { contract_id?: unknown; buy_price?: unknown; payout?: unknown };
  proposal_open_contract?: {
    contract_id?: unknown;
    is_sold?: unknown;
    profit?: unknown;
    tick_count?: unknown;
    tick_stream?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

export function subscribeDerivBalance(options: {
  accessToken: string;
  appId: string;
  accountId: string;
  onBalance: (balance: { accountId: string; balance: number; currency: string }) => void;
  onError: (message: string) => void;
}) {
  const socketUrl = new URL("wss://ws.derivws.com/websockets/v3");
  socketUrl.searchParams.set("app_id", options.appId);
  const socket = new WebSocket(socketUrl.toString(), { handshakeTimeout: 10_000 });
  let authorized = false;
  let finished = false;
  const timeout = setTimeout(() => {
    fail("Deriv balance subscription timed out.");
  }, 15_000);

  const close = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else if (socket.readyState === WebSocket.OPEN) socket.close();
  };

  const fail = (message: string) => {
    if (finished) return;
    options.onError(message);
    close();
  };

  socket.on("open", () => {
    socket.send(JSON.stringify({ authorize: options.accessToken, req_id: 1 }));
  });

  socket.on("message", (data) => {
    let message: DerivMessage;
    try {
      message = JSON.parse(data.toString()) as DerivMessage;
    } catch {
      fail("Deriv sent an unreadable balance update.");
      return;
    }

    if (message.error) {
      fail(message.error.message || "Deriv balance subscription failed.");
      return;
    }

    if (message.msg_type === "authorize" && !authorized) {
      authorized = true;
      socket.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 2 }));
      return;
    }

    if (message.msg_type !== "balance" || !message.balance) return;
    const balance = parseAmount(message.balance.balance);
    const accountId = message.balance.loginid;
    const currency = message.balance.currency;
    if (
      accountId !== options.accountId ||
      balance === null ||
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency)
    ) return;

    clearTimeout(timeout);
    options.onBalance({ accountId, balance, currency });
  });

  socket.on("error", () => {
    fail("Could not connect to Deriv live balance updates.");
  });
  socket.on("close", () => {
    if (!finished) fail("Deriv live balance updates disconnected.");
  });

  return close;
}

export async function executeDerivFiveTickTrade(options: TradeOptions) {
  let otpResponse: Response;
  try {
    otpResponse = await fetch(
      `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(options.accountId)}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new DerivTradeError("Could not authorize the Deriv trading connection.");
  }

  if (!otpResponse.ok) {
    throw new DerivTradeError(
      otpResponse.status === 401 || otpResponse.status === 403
        ? "Deriv authorization expired or does not allow trading. Reconnect your account."
        : "Deriv could not authorize a trading connection.",
    );
  }

  const otpPayload: unknown = await otpResponse.json().catch(() => null);
  const otpUrlValue = isRecord(otpPayload) && isRecord(otpPayload.data)
    ? otpPayload.data.url
    : null;
  if (typeof otpUrlValue !== "string") {
    throw new DerivTradeError("Deriv returned an invalid trading connection.");
  }

  let otpUrl: URL;
  try {
    otpUrl = new URL(otpUrlValue);
  } catch {
    throw new DerivTradeError("Deriv returned an invalid trading connection.");
  }
  const expectedPath = `/trading/v1/options/ws/${options.accountType}`;
  if (
    otpUrl.protocol !== "wss:" ||
    otpUrl.hostname !== "api.derivws.com" ||
    otpUrl.pathname !== expectedPath ||
    !otpUrl.searchParams.has("otp")
  ) {
    throw new DerivTradeError("Deriv returned an unexpected trading connection.");
  }

  return new Promise<{
    contractId: number;
    contractType: "CALL" | "PUT";
    stake: number;
    payout: number;
    currency: string;
    profit: number;
  }>((resolve, reject) => {
    const socket = new WebSocket(otpUrl.toString(), { handshakeTimeout: 10_000 });
    let phase: "proposal" | "buy" | "contract" = "proposal";
    let contractId: number | null = null;
    let actualStake: number | null = null;
    let actualPayout: number | null = null;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        phase === "contract"
          ? "The trade was placed, but its final result could not be confirmed. The bot has stopped."
          : "Deriv did not respond in time. No further trades will be attempted.",
        phase !== "proposal",
      );
    }, 65_000);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close();
    };

    const fail = (message: string, tradeMayBeOpen = false, code?: string) => {
      finish(() => reject(new DerivTradeError(message, tradeMayBeOpen, code)));
    };

    const send = (payload: Record<string, unknown>, errorMessage: string) => {
      try {
        if (socket.readyState !== WebSocket.OPEN) throw new Error("Trading socket is not open.");
        socket.send(JSON.stringify(payload));
      } catch {
        fail(errorMessage, phase === "contract");
      }
    };

    socket.on("open", () => {
      send({
        proposal: 1,
        amount: options.stake,
        basis: "stake",
        contract_type: options.contractType,
        currency: options.currency,
        duration: 5,
        duration_unit: "t",
        underlying_symbol: "R_100",
        req_id: 1,
      }, "Could not request a Deriv trade proposal.");
    });

    socket.on("message", (data) => {
      let message: DerivMessage;
      try {
        message = JSON.parse(data.toString()) as DerivMessage;
      } catch {
        fail("Deriv returned an unreadable trading response.", phase !== "proposal");
        return;
      }

      if (message.error) {
        const errorMessage = message.error.message || "Deriv rejected the trade.";
        const insufficientBalance = /insufficient.*(balance|funds)|balance.*insufficient|not enough.*(balance|funds)/i
          .test(errorMessage);
        fail(
          insufficientBalance
            ? "Insufficient balance for this trade. The bot has stopped."
            : errorMessage,
          phase === "contract",
          insufficientBalance || /insufficient.?balance/i.test(message.error.code ?? "")
            ? "INSUFFICIENT_BALANCE"
            : undefined,
        );
        return;
      }

      if (phase === "proposal" && message.msg_type === "proposal") {
        const proposalId = message.proposal?.id;
        const askPrice = parseAmount(message.proposal?.ask_price);
        if (typeof proposalId !== "string" || askPrice === null || askPrice <= 0) {
          fail("Deriv returned an invalid trade proposal.");
          return;
        }
        phase = "buy";
        send({ buy: proposalId, price: askPrice, req_id: 2 }, "Could not buy the Deriv contract.");
        return;
      }

      if (phase === "buy" && message.msg_type === "buy") {
        const returnedContractId = message.buy?.contract_id;
        if (typeof returnedContractId !== "number" || !Number.isSafeInteger(returnedContractId)) {
          fail("Deriv did not confirm the contract purchase. The bot has stopped.", true);
          return;
        }
        contractId = returnedContractId;
        phase = "contract";
        actualStake = parseAmount(message.buy?.buy_price);
        actualPayout = parseAmount(message.buy?.payout);
        if (actualStake === null || actualPayout === null) {
          fail("Deriv confirmed the purchase but returned invalid stake or payout details.", true);
          return;
        }
        options.onPurchased?.({ stake: actualStake, payout: actualPayout });
        send({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1,
          req_id: 3,
        }, "The trade was placed, but its final result could not be confirmed. The bot has stopped.");
        return;
      }

      if (phase === "contract" && message.msg_type === "proposal_open_contract") {
        const contract = message.proposal_open_contract;
        if (contract?.contract_id === contractId && Array.isArray(contract.tick_stream)) {
          const ticksPassed = Math.min(5, contract.tick_stream.length);
          const totalTicks = typeof contract.tick_count === "number" && contract.tick_count > 0
            ? contract.tick_count
            : 5;
          options.onProgress?.({ ticksPassed, totalTicks });
        }
        if (
          !contract ||
          typeof contract.contract_id !== "number" ||
          contract.contract_id !== contractId ||
          contract.is_sold !== 1
        ) return;
        const finalContractId = contract.contract_id;
        const finalStake = actualStake;
        const finalPayout = actualPayout;
        const profit = parseAmount(contract.profit);
        if (profit === null || finalStake === null || finalPayout === null) {
          fail("The contract settled, but Deriv returned no valid profit amount.", true);
          return;
        }
        finish(() => resolve({
          contractId: finalContractId,
          contractType: options.contractType,
          stake: finalStake,
          payout: finalPayout,
          currency: options.currency,
          profit,
        }));
      }
    });

    socket.on("error", () => {
      fail(
        phase === "contract"
          ? "The trade was placed, but its final result could not be confirmed. The bot has stopped."
          : "Could not connect to Deriv trading. No further trades will be attempted.",
        phase !== "proposal",
      );
    });

    socket.on("close", () => {
      if (!settled) {
        fail(
          phase === "contract"
            ? "The trade was placed, but its final result could not be confirmed. The bot has stopped."
            : "The Deriv trading connection closed before the trade completed.",
          phase !== "proposal",
        );
      }
    });
  });
}
