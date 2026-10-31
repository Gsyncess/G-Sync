import WebSocket from "ws";

export class DerivTradeError extends Error {
  constructor(message: string, readonly tradeMayBeOpen = false) {
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
};

type DerivMessage = {
  msg_type?: string;
  error?: { message?: string };
  proposal?: { id?: unknown; ask_price?: unknown };
  buy?: { contract_id?: unknown; buy_price?: unknown };
  proposal_open_contract?: {
    contract_id?: unknown;
    is_sold?: unknown;
    profit?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
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
    profit: number;
  }>((resolve, reject) => {
    const socket = new WebSocket(otpUrl.toString(), { handshakeTimeout: 10_000 });
    let phase: "proposal" | "buy" | "contract" = "proposal";
    let contractId: number | null = null;
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

    const fail = (message: string, tradeMayBeOpen = false) => {
      finish(() => reject(new DerivTradeError(message, tradeMayBeOpen)));
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
        fail(
          message.error.message || "Deriv rejected the trade.",
          phase === "contract",
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
        if (
          !contract ||
          typeof contract.contract_id !== "number" ||
          contract.contract_id !== contractId ||
          contract.is_sold !== 1
        ) return;
        const finalContractId = contract.contract_id;
        const profit = parseAmount(contract.profit);
        if (profit === null) {
          fail("The contract settled, but Deriv returned no valid profit amount.", true);
          return;
        }
        finish(() => resolve({
          contractId: finalContractId,
          contractType: options.contractType,
          stake: options.stake,
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
