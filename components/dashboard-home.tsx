"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  CircleHelp,
  Clock3,
  Home,
  LogOut,
  Settings2,
  X,
} from "lucide-react";
import { MarketConsole, type MarketSignal } from "@/components/market-console";
import { SignalPage, type SignalConfig } from "@/components/signal-page";

type DerivAccount = {
  accountId: string;
  accountType: string;
  balance: number;
  currency: string;
};

type DerivSessionResponse = {
  connected?: boolean;
  expired?: boolean;
  accounts?: DerivAccount[];
  warning?: string;
  error?: string;
};

type AccountPerformance = {
  profit: number;
  wins: number;
  losses: number;
  trades: number;
};

type OpenTradeDetails = {
  stake: number;
  payout: number;
  currency: string;
  contractType: "CALL" | "PUT";
};

type TradeHistoryEntry = {
  id: string;
  contractId: number;
  contractType: "CALL" | "PUT";
  stake: number;
  payout: number;
  currency: string;
  profit: number;
  completedAt: string;
};

type TradeErrorToast = {
  id: number;
  message: string;
};

type BotRuntime = {
  running: boolean;
  inFlight: boolean;
  unresolvedTrade: boolean;
  nextStake: number | null;
  sessionProfit: number;
};

type DashboardHomeProps = {
  email: string;
  socketOnline: boolean;
  onSignOut: () => void;
};

function isTradeHistoryEntry(value: unknown): value is TradeHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.contractId === "number" &&
    (entry.contractType === "CALL" || entry.contractType === "PUT") &&
    typeof entry.stake === "number" &&
    typeof entry.payout === "number" &&
    typeof entry.currency === "string" &&
    typeof entry.profit === "number" &&
    typeof entry.completedAt === "string"
  );
}

export function DashboardHome({ email, socketOnline, onSignOut }: DashboardHomeProps) {
  const [derivAccounts, setDerivAccounts] = useState<DerivAccount[]>([]);
  const [derivConnected, setDerivConnected] = useState(false);
  const [derivBusy, setDerivBusy] = useState(true);
  const [derivMessage, setDerivMessage] = useState("");
  const [selectedDerivAccountId, setSelectedDerivAccountId] = useState("");
  const [derivMenuOpen, setDerivMenuOpen] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const [tradeProgressTicks, setTradeProgressTicks] = useState(0);
  const [openTradeDetails, setOpenTradeDetails] = useState<OpenTradeDetails | null>(null);
  const [botStatus, setBotStatus] = useState("Ready");
  const [tradeErrorToast, setTradeErrorToast] = useState<TradeErrorToast | null>(null);
  const [marketFeedStatus, setMarketFeedStatus] = useState<"Connecting" | "Live" | "Reconnecting" | "Unavailable">("Connecting");
  const [activeView, setActiveView] = useState<"home" | "signals" | "history">("home");
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyAccountId, setHistoryAccountId] = useState("");
  const [botConfig, setBotConfig] = useState<SignalConfig>({
    targetProfit: 20,
    targetLoss: 10,
    stakeAmount: 5,
  });
  const selectedDerivAccount = derivAccounts.find(
    (account) => account.accountId === selectedDerivAccountId,
  );
  const accountTrades = historyAccountId === selectedDerivAccountId ? tradeHistory : [];
  const accountPerformance = accountTrades.reduce<AccountPerformance>((summary, trade) => ({
    profit: summary.profit + trade.profit,
    wins: summary.wins + (trade.profit > 0 ? 1 : 0),
    losses: summary.losses + (trade.profit < 0 ? 1 : 0),
    trades: summary.trades + 1,
  }), { profit: 0, wins: 0, losses: 0, trades: 0 });
  const derivMenuRef = useRef<HTMLDivElement>(null);
  const botConfigRef = useRef(botConfig);
  botConfigRef.current = botConfig;
  const selectedAccountRef = useRef<DerivAccount | undefined>(undefined);
  selectedAccountRef.current = selectedDerivAccount;
  const derivConnectedRef = useRef(derivConnected);
  derivConnectedRef.current = derivConnected;
  const marketFeedStatusRef = useRef(marketFeedStatus);
  marketFeedStatusRef.current = marketFeedStatus;
  const tradeToastTimerRef = useRef<number | null>(null);
  const tradeToastIdRef = useRef(0);
  const botRuntimeRef = useRef<BotRuntime>({
    running: false,
    inFlight: false,
    unresolvedTrade: false,
    nextStake: null,
    sessionProfit: 0,
  });

  const loadDerivSession = useCallback(async () => {
    setDerivBusy(true);
    try {
      const response = await fetch("/api/deriv/session", { cache: "no-store" });
      const result = (await response.json()) as DerivSessionResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not check the Deriv connection.");
      setDerivConnected(result.connected === true);
      const accounts = result.accounts ?? [];
      setDerivAccounts(accounts);
      const saved = window.localStorage.getItem("deriv-account-id");
      const nextId = accounts.some((account) => account.accountId === saved)
        ? saved!
        : accounts.find((account) => account.accountType === "demo")?.accountId
          ?? accounts[0]?.accountId
          ?? "";
      setSelectedDerivAccountId(nextId);
      if (nextId) window.localStorage.setItem("deriv-account-id", nextId);
      else window.localStorage.removeItem("deriv-account-id");
      if (result.warning) setDerivMessage(result.warning);
      if (result.expired) setDerivMessage("Your Deriv authorization expired. Please connect again.");
    } catch (error) {
      setDerivMessage(error instanceof Error ? error.message : "Could not check the Deriv connection.");
    } finally {
      setDerivBusy(false);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthResult = url.searchParams.get("deriv_oauth");
    if (oauthResult) {
      setDerivMessage(
        oauthResult === "connected"
          ? "Your Deriv account is connected."
          : oauthResult === "cancelled"
            ? "Deriv authorization was cancelled."
            : oauthResult === "state_mismatch"
              ? "Deriv authorization could not be verified. Start Connect again and finish in the same browser."
              : oauthResult === "redirect_mismatch"
                ? "The callback URL does not match the one configured with Deriv. Check DERIV_REDIRECT_URI."
                : oauthResult === "oauth_not_configured"
                  ? "Deriv OAuth is not configured on the server."
                  : oauthResult === "token_exchange_failed"
                    ? "Deriv approved the login, but token exchange failed. Check the Heroku logs and app ID."
                    : oauthResult === "callback_invalid"
                      ? "Deriv returned an incomplete authorization response. Please connect again."
                      : oauthResult === "token_response_invalid"
                        ? "Deriv returned an invalid token response. Please try again."
                        : "Deriv authorization failed. Please try again.",
      );
      url.searchParams.delete("deriv_oauth");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void loadDerivSession();
  }, [loadDerivSession]);

  useEffect(() => {
    setHistoryReady(false);
    if (!selectedDerivAccountId) {
      setTradeHistory([]);
      setHistoryAccountId("");
      setHistoryReady(true);
      return;
    }

    try {
      const saved = window.localStorage.getItem(`deriv-bot-history:${selectedDerivAccountId}`);
      if (!saved) {
        setTradeHistory([]);
      } else {
        const parsed: unknown = JSON.parse(saved);
        setTradeHistory(Array.isArray(parsed) ? parsed.filter(isTradeHistoryEntry).slice(0, 100) : []);
      }
      setHistoryAccountId(selectedDerivAccountId);
    } catch (error) {
      console.warn("Could not load saved Deriv bot history.", error);
      setTradeHistory([]);
      setHistoryAccountId(selectedDerivAccountId);
      setDerivMessage("Saved trade history could not be loaded.");
    } finally {
      setHistoryReady(true);
    }
  }, [selectedDerivAccountId]);

  useEffect(() => {
    if (!historyReady || !selectedDerivAccountId || historyAccountId !== selectedDerivAccountId) return;
    try {
      window.localStorage.setItem(
        `deriv-bot-history:${selectedDerivAccountId}`,
        JSON.stringify(tradeHistory),
      );
    } catch (error) {
      console.warn("Could not save Deriv bot history.", error);
      setDerivMessage("Trade history could not be saved on this device.");
    }
  }, [historyAccountId, historyReady, selectedDerivAccountId, tradeHistory]);

  useEffect(() => {
    if (!derivMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !derivMenuRef.current?.contains(event.target)) {
        setDerivMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDerivMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [derivMenuOpen]);

  useEffect(() => () => {
    if (tradeToastTimerRef.current !== null) {
      window.clearTimeout(tradeToastTimerRef.current);
    }
  }, []);

  const notifyTradeError = useCallback((message: string) => {
    if (tradeToastTimerRef.current !== null) {
      window.clearTimeout(tradeToastTimerRef.current);
    }
    const id = ++tradeToastIdRef.current;
    setTradeErrorToast({ id, message });
    tradeToastTimerRef.current = window.setTimeout(() => {
      setTradeErrorToast((current) => current?.id === id ? null : current);
      tradeToastTimerRef.current = null;
    }, 8000);
  }, []);

  const handleFeedStatus = useCallback((status: typeof marketFeedStatus) => {
    setMarketFeedStatus(status);
  }, []);

  const handleMarketSignal = useCallback((signal: MarketSignal) => {
    const runtime = botRuntimeRef.current;
    if (
      !signal.ready ||
      !runtime.running ||
      runtime.inFlight ||
      marketFeedStatusRef.current !== "Live" ||
      !signal.crossover
    ) return;

    const config = botConfigRef.current;
    if (runtime.sessionProfit >= config.targetProfit || runtime.sessionProfit <= -config.targetLoss) {
      runtime.running = false;
      setBotRunning(false);
      setBotStatus(runtime.sessionProfit >= config.targetProfit ? "Session profit target reached" : "Session loss limit reached");
      return;
    }

    const account = selectedAccountRef.current;
    if (!derivConnectedRef.current || !account) {
      runtime.running = false;
      setBotRunning(false);
      setBotStatus("Deriv account unavailable. Bot stopped.");
      return;
    }

    const contractType = signal.crossover;
    const stake = runtime.nextStake ?? config.stakeAmount;

    runtime.inFlight = true;
    setTradeInProgress(true);
    setTradeProgressTicks(0);
    setOpenTradeDetails(null);
    setBotStatus(`${contractType} · placing 5-tick contract`);
    void (async () => {
      try {
        const response = await fetch("/api/deriv/bot-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: account.accountId,
            contractType,
            stake,
          }),
        });
        if (!response.ok) {
          const result = await response.json() as {
            error?: unknown;
            tradeMayBeOpen?: unknown;
          };
          const tradeMayBeOpen = result.tradeMayBeOpen === true;
          runtime.inFlight = tradeMayBeOpen;
          runtime.unresolvedTrade = tradeMayBeOpen;
          runtime.running = false;
          setBotRunning(false);
          if (!tradeMayBeOpen) setOpenTradeDetails(null);
          const errorMessage = typeof result.error === "string"
            ? result.error
            : "Trade failed. The bot was stopped.";
          notifyTradeError(errorMessage);
          setBotStatus(
            tradeMayBeOpen
              ? "Trade result unconfirmed. Check Deriv open positions; bot stopped."
              : errorMessage,
          );
          return;
        }

        if (!response.body) throw new Error("Deriv trade updates were unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let remaining = "";
        let settledProfit: number | null = null;
        let settledTrade: TradeHistoryEntry | null = null;
        let streamFailed = false;

        const handleTradeEvent = (line: string) => {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            throw new Error("Deriv returned an unreadable trade update.");
          }
          if (!event || typeof event !== "object") {
            throw new Error("Deriv returned an invalid trade update.");
          }
          const update = event as Record<string, unknown>;

          if (update.type === "purchased") {
            if (
              typeof update.stake !== "number" ||
              !Number.isFinite(update.stake) ||
              typeof update.payout !== "number" ||
              !Number.isFinite(update.payout) ||
              typeof update.currency !== "string" ||
              (update.contractType !== "CALL" && update.contractType !== "PUT")
            ) {
              throw new Error("Deriv returned invalid stake or payout details.");
            }
            setOpenTradeDetails({
              stake: update.stake,
              payout: update.payout,
              currency: update.currency,
              contractType: update.contractType,
            });
            return;
          }

          if (update.type === "progress") {
            if (
              typeof update.ticksPassed !== "number" ||
              !Number.isFinite(update.ticksPassed) ||
              typeof update.totalTicks !== "number" ||
              !Number.isFinite(update.totalTicks)
            ) {
              throw new Error("Deriv returned invalid contract progress.");
            }
            setTradeProgressTicks(Math.max(0, Math.min(5, update.ticksPassed)));
            return;
          }

          if (update.type === "settled") {
            if (
              typeof update.contractId !== "number" ||
              (update.contractType !== "CALL" && update.contractType !== "PUT") ||
              typeof update.stake !== "number" ||
              typeof update.payout !== "number" ||
              typeof update.currency !== "string" ||
              typeof update.profit !== "number" ||
              !Number.isFinite(update.profit)
            ) {
              throw new Error("Deriv returned an invalid contract result.");
            }
            settledProfit = update.profit;
            const completedAt = new Date().toISOString();
            settledTrade = {
              id: `${account.accountId}-${update.contractId}-${completedAt}`,
              contractId: update.contractId,
              contractType: update.contractType,
              stake: update.stake,
              payout: update.payout,
              currency: update.currency,
              profit: update.profit,
              completedAt,
            };
            setTradeProgressTicks(5);
            setOpenTradeDetails(null);
            return;
          }

          if (update.type === "error") {
            const tradeMayBeOpen = update.tradeMayBeOpen === true;
            runtime.inFlight = tradeMayBeOpen;
            runtime.unresolvedTrade = tradeMayBeOpen;
            runtime.running = false;
            setBotRunning(false);
            if (!tradeMayBeOpen) {
              setOpenTradeDetails(null);
              setTradeProgressTicks(0);
            }
            setBotStatus(
              tradeMayBeOpen
                ? "Trade result unconfirmed. Check Deriv open positions; bot stopped."
                : typeof update.error === "string" ? update.error : "Trade failed. Bot stopped.",
            );
            notifyTradeError(
              typeof update.error === "string" ? update.error : "Trade failed. The bot was stopped.",
            );
            streamFailed = true;
            return;
          }

          throw new Error("Deriv returned an unknown trade update.");
        };

        while (true) {
          const { value, done } = await reader.read();
          remaining += decoder.decode(value, { stream: !done });
          const lines = remaining.split("\n");
          remaining = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) handleTradeEvent(line);
            if (streamFailed) break;
          }
          if (streamFailed || done) break;
        }
        if (remaining.trim() && !streamFailed) handleTradeEvent(remaining);
        if (streamFailed) return;
        const completedTrade = settledTrade;
        if (settledProfit === null || completedTrade === null) {
          throw new Error("Deriv ended the trade stream before settlement.");
        }

        const profit = settledProfit;
        setTradeHistory((current) => [completedTrade, ...current].slice(0, 100));
        runtime.sessionProfit += profit;
        if (profit > 0) {
          runtime.nextStake = config.stakeAmount;
        } else if (profit < 0) {
          runtime.nextStake = Number((stake * 1.5).toFixed(2));
        }

        if (runtime.sessionProfit >= botConfigRef.current.targetProfit) {
          runtime.running = false;
          setBotRunning(false);
          setBotStatus("Session profit target reached");
        } else if (runtime.sessionProfit <= -botConfigRef.current.targetLoss) {
          runtime.running = false;
          setBotRunning(false);
          setBotStatus("Session loss limit reached");
        } else {
          setBotStatus(
            runtime.running
              ? `${profit >= 0 ? "Trade won" : "Trade lost"} · ${profit >= 0 ? "base stake restored" : "next stake ×1.5"}`
              : "Bot stopped · current trade settled",
          );
        }
      } catch (error) {
        runtime.inFlight = true;
        runtime.unresolvedTrade = true;
        runtime.running = false;
        setBotRunning(false);
        const errorMessage = error instanceof Error
          ? error.message
          : "Trade result could not be confirmed.";
        notifyTradeError(`${errorMessage} Check Deriv positions before restarting.`);
        setBotStatus(
          `${errorMessage} Check Deriv positions before restarting.`,
        );
      } finally {
        if (!runtime.unresolvedTrade) runtime.inFlight = false;
        setTradeInProgress(runtime.inFlight || runtime.unresolvedTrade);
        if (!runtime.unresolvedTrade) setTradeProgressTicks(0);
      }
    })();
  }, [notifyTradeError]);

  const disconnectDeriv = async () => {
    botRuntimeRef.current.running = false;
    setBotRunning(false);
    setDerivBusy(true);
    setDerivMessage("");
    try {
      const response = await fetch("/api/deriv/session/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Could not disconnect the Deriv account.");
      setDerivConnected(false);
      setDerivAccounts([]);
      setSelectedDerivAccountId("");
      setDerivMenuOpen(false);
      window.localStorage.removeItem("deriv-account-id");
      setDerivMessage("Your Deriv account has been disconnected.");
    } catch (error) {
      setDerivMessage(error instanceof Error ? error.message : "Could not disconnect the Deriv account.");
    } finally {
      setDerivBusy(false);
    }
  };

  const handleStartBot = () => {
    const runtime = botRuntimeRef.current;
    if (
      !derivConnected ||
      !selectedDerivAccount ||
      marketFeedStatus !== "Live" ||
      runtime.inFlight ||
      runtime.unresolvedTrade
    ) return;
    if (runtime.sessionProfit >= botConfig.targetProfit || runtime.sessionProfit <= -botConfig.targetLoss) {
      setBotStatus(runtime.sessionProfit >= botConfig.targetProfit ? "Session profit target reached" : "Session loss limit reached");
      return;
    }
    runtime.running = true;
    runtime.nextStake ??= botConfig.stakeAmount;
    setBotRunning(true);
    setBotStatus(
      selectedDerivAccount.accountType === "real"
        ? "Watching market · real-account trades enabled"
        : "Watching market · demo account",
    );
  };

  const handleStopBot = () => {
    botRuntimeRef.current.running = false;
    setBotRunning(false);
    setBotStatus(
      botRuntimeRef.current.inFlight
        ? "Stopped · current contract will finish"
        : "Ready",
    );
  };

  const accountSummary = derivAccounts
    .map(({ accountType, currency }) => [accountType, currency].filter(Boolean).join(" · "))
    .join(", ");
  const formatBalance = (account: DerivAccount, compact = false) => {
    const currency = /^[A-Z]{3}$/.test(account.currency) ? account.currency : "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: compact ? 1 : 2,
      }).format(account.balance);
    } catch {
      return `$${account.balance.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  };
  const formatPerformanceAmount = (value: number) => {
    const currency = selectedDerivAccount?.currency ?? "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };
  const formatTradeAmount = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };
  const formatTradeTime = (date: string) => {
    const parsedDate = new Date(date);
    return Number.isNaN(parsedDate.getTime())
      ? "Unknown time"
      : parsedDate.toLocaleString();
  };
  const decidedTrades = accountPerformance.wins + accountPerformance.losses;
  const hasReliableWinRate = decidedTrades >= 5;
  const winRate = hasReliableWinRate
    ? Math.round((accountPerformance.wins / decidedTrades) * 100)
    : 0;
  const selectDerivAccount = (account: DerivAccount) => {
    if (botRuntimeRef.current.running || botRuntimeRef.current.inFlight) return;
    botRuntimeRef.current = {
      running: false,
      inFlight: false,
      unresolvedTrade: false,
      nextStake: null,
      sessionProfit: 0,
    };
    setSelectedDerivAccountId(account.accountId);
    window.localStorage.setItem("deriv-account-id", account.accountId);
    setDerivMenuOpen(false);
  };

  return (
    <main className="dashboard-shell">
      {tradeErrorToast && (
        <div className="trade-error-toast" role="alert" key={tradeErrorToast.id}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{tradeErrorToast.message}</span>
          <button
            type="button"
            aria-label="Dismiss trade error"
            onClick={() => {
              if (tradeToastTimerRef.current !== null) {
                window.clearTimeout(tradeToastTimerRef.current);
                tradeToastTimerRef.current = null;
              }
              setTradeErrorToast(null);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <header className="dashboard-header">
        <a href="#home" className="dashboard-brand" aria-label="G-Sync home">
          <span className="dashboard-brand-icon"><Bot size={19} strokeWidth={2.2} /></span>
          <span>G-Sync<span className="dashboard-brand-dot">.</span></span>
        </a>
        <div className="dashboard-header-actions">
          <span className="dashboard-live-indicator">
            <span className={socketOnline ? "status-dot status-dot-live" : "status-dot"} />
            {socketOnline ? "Synced" : "Offline"}
          </span>
          {derivConnected && selectedDerivAccount ? (
            <div className="deriv-account-switcher" ref={derivMenuRef}>
              <button
                type="button"
                className="deriv-header-button deriv-balance-button"
                onClick={() => setDerivMenuOpen((open) => !open)}
                disabled={derivBusy || botRunning || botRuntimeRef.current.inFlight}
                title={`${formatBalance(selectedDerivAccount)} · ${selectedDerivAccount.accountType} account`}
                aria-label={`Deriv ${selectedDerivAccount.accountType} balance ${formatBalance(selectedDerivAccount)}. Switch account`}
                aria-expanded={derivMenuOpen}
                aria-haspopup="menu"
                aria-controls="deriv-account-menu"
              >
                <span>{formatBalance(selectedDerivAccount, true)}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {derivMenuOpen && (
                <div className="deriv-account-menu" id="deriv-account-menu" role="menu" aria-label="Switch Deriv account">
                  {derivAccounts.map((account) => (
                    <button
                      type="button"
                      key={account.accountId}
                      className="deriv-account-option"
                      role="menuitemradio"
                      aria-checked={account.accountId === selectedDerivAccount.accountId}
                      onClick={() => selectDerivAccount(account)}
                      disabled={botRunning || botRuntimeRef.current.inFlight}
                    >
                      <span>
                        <strong>{account.accountType === "demo" ? "Demo" : "Real"}</strong>
                        <small>{account.currency}</small>
                      </span>
                      <span>{formatBalance(account)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="deriv-account-disconnect"
                    role="menuitem"
                    onClick={() => void disconnectDeriv()}
                    disabled={botRunning || botRuntimeRef.current.inFlight}
                  >
                    Disconnect Deriv
                  </button>
                </div>
              )}
            </div>
          ) : derivConnected ? (
            <button
              type="button"
              className="deriv-header-button"
              onClick={() => void disconnectDeriv()}
              disabled={derivBusy || botRunning || botRuntimeRef.current.inFlight}
              title={accountSummary || "No eligible Deriv accounts found"}
              aria-label="Deriv connected, disconnect account"
            >
              Connected
            </button>
          ) : (
            <a
              className="deriv-header-button"
              href="/api/deriv/oauth/start"
              aria-label="Connect and authorize your Deriv account"
              aria-disabled={derivBusy}
              title={derivBusy ? "Checking Deriv connection" : "Connect and authorize your Deriv account"}
              onClick={(event) => {
                if (derivBusy) event.preventDefault();
              }}
            >
              {derivBusy ? "…" : "Connect"}
            </a>
          )}
          <button type="button" className="dashboard-icon-button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section
        className={`dashboard-content ${activeView === "home" ? "dashboard-content-pinned" : "dashboard-content-scroll"}`}
        aria-label="Dashboard pages"
      >
        <div className="dashboard-home-view" id="dashboard-home-view" hidden={activeView !== "home"}>
            <div className="dashboard-greeting">
              <div>
                <p className="dashboard-eyebrow">TRADING OVERVIEW</p>
                <h1 id="dashboard-title">Your dashboard</h1>
                <p className="dashboard-subtitle">{email || "Your G-Sync account"}</p>
              </div>
              <span className="market-session">
                <span className={`status-dot ${marketFeedStatus === "Live" ? "status-dot-live" : "status-dot-waiting"}`} />
                {marketFeedStatus === "Live" ? "Market live" : `Market ${marketFeedStatus.toLowerCase()}`}
              </span>
            </div>

            <MarketConsole onMarketSignal={handleMarketSignal} onFeedStatus={handleFeedStatus} />

            <section
              className="performance-panel"
              aria-label="Trading performance"
              key={selectedDerivAccountId || "no-account"}
            >
              <div className="performance-heading">
                <div>
                  <h2>Bot performance</h2>
                  <p>Saved account results · latest 100 trades</p>
                </div>
                <button type="button" className="help-button" aria-label="Performance help" title="Performance updates after your Deriv account is connected">
                  <CircleHelp size={17} />
                </button>
              </div>
              <div className="performance-metrics">
                <div className="performance-metric">
                  <span>P/L</span>
                  <strong
                    key={`profit-${accountPerformance.trades}`}
                    className={accountPerformance.profit > 0 ? "performance-positive" : accountPerformance.profit < 0 ? "performance-negative" : ""}
                  >
                    {derivConnected ? formatPerformanceAmount(accountPerformance.profit) : "--"}
                  </strong>
                </div>
                <div className="performance-metric">
                  <span>W</span>
                  <strong key={`wins-${accountPerformance.trades}`}>{accountPerformance.wins}</strong>
                </div>
                <div className="performance-metric">
                  <span>L</span>
                  <strong key={`losses-${accountPerformance.trades}`}>{accountPerformance.losses}</strong>
                </div>
                <div className="performance-metric performance-rate">
                  <span>Win rate</span>
                  <div
                    className="rate-ring"
                    title="Based on saved completed trades for this account; breakeven trades are excluded. Shown after five decided trades."
                    style={{
                      background: `conic-gradient(#168c7a ${winRate}%, #e4eaf0 ${winRate}% 100%)`,
                    }}
                    aria-label={
                      hasReliableWinRate
                        ? `Win rate ${winRate} percent from ${decidedTrades} trades`
                        : `Win rate shown after five decided trades; ${decidedTrades} decided so far`
                    }
                  >
                    <span>{hasReliableWinRate ? `${winRate}%` : "--"}</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="home-bot-controls" aria-label="Bot controls">
              <div className="bot-trade-progress" role="status" aria-live="polite">
                <div className="bot-trade-progress-heading">
                  <span>Open trade progress</span>
                  <span>{tradeInProgress ? "In progress" : "No open trade"}</span>
                </div>
                <div
                  className="bot-trade-progress-track"
                  role="progressbar"
                  aria-label="5-tick trade progress"
                  aria-valuemin={0}
                  aria-valuemax={5}
                  aria-valuenow={tradeProgressTicks}
                  aria-valuetext={tradeInProgress ? "Trade is being processed and awaiting settlement" : "No open trade"}
                >
                  <span style={{ width: `${(tradeProgressTicks / 5) * 100}%` }} />
                </div>
                <div className="bot-trade-values" aria-live="polite">
                  {openTradeDetails ? (
                    <>
                      <span>{openTradeDetails.contractType}</span>
                      <span>Stake {formatTradeAmount(openTradeDetails.stake, openTradeDetails.currency)}</span>
                      <span>Potential payout {formatTradeAmount(openTradeDetails.payout, openTradeDetails.currency)}</span>
                      <span>{tradeProgressTicks} / 5 ticks</span>
                    </>
                  ) : tradeInProgress ? (
                    <span>Waiting for Deriv contract details…</span>
                  ) : (
                    <span>No active contract</span>
                  )}
                </div>
                <span className="sr-only">{botStatus}</span>
              </div>
              {derivMessage && <span className="sr-only" role="status">{derivMessage}</span>}
              <div className="bot-controls">
                <button
                  type="button"
                  className="bot-start-button"
                  onClick={handleStartBot}
                  disabled={!derivConnected || !selectedDerivAccount || derivBusy || botRunning || marketFeedStatus !== "Live" || botRuntimeRef.current.unresolvedTrade}
                  title={botRuntimeRef.current.unresolvedTrade ? "Check Deriv open positions before starting again" : undefined}
                >
                  Start bot
                </button>
                <button
                  type="button"
                  className="bot-stop-button"
                  onClick={handleStopBot}
                  disabled={!botRunning}
                >
                  Stop
                </button>
              </div>
              <p className={`dashboard-disclaimer ${selectedDerivAccount?.accountType === "real" ? "dashboard-disclaimer-real" : ""}`}>
                {botRuntimeRef.current.unresolvedTrade
                  ? "A trade result is unconfirmed. Verify open positions in Deriv before reloading or restarting."
                  : selectedDerivAccount?.accountType === "real"
                    ? "Real account selected. Starting the bot can place live trades using 5-tick contracts."
                    : "Bot signals use MACD crossovers. Contracts run for 5 ticks; the next stake rises 1.5× after a loss."}
              </p>
            </div>
        </div>
        <div className="dashboard-config-view" id="dashboard-config-view" hidden={activeView !== "signals"}>
          <SignalPage
            botConfig={botConfig}
            onConfigChange={setBotConfig}
          />
        </div>
        <div className="dashboard-history-view" id="dashboard-history-view" hidden={activeView !== "history"}>
          <section className="market-panel history-panel" aria-label="Completed bot trade history">
            <header className="history-heading">
              <div>
                <h2>Trade history</h2>
                <p>Completed bot trades for this Deriv account</p>
              </div>
              <span>{historyReady ? tradeHistory.length : "…"}</span>
            </header>
            {!historyReady ? (
              <p className="history-empty">Loading trade history…</p>
            ) : tradeHistory.length === 0 ? (
              <p className="history-empty">No completed bot trades for this account yet.</p>
            ) : (
              <div className="history-list">
                {tradeHistory.map((trade) => (
                  <article className="history-entry" key={trade.id}>
                    <div className="history-entry-main">
                      <strong>{trade.contractType} · R_100 · 5 ticks</strong>
                      <time dateTime={trade.completedAt}>{formatTradeTime(trade.completedAt)}</time>
                    </div>
                    <div className="history-entry-values">
                      <span>Stake <strong>{formatTradeAmount(trade.stake, trade.currency)}</strong></span>
                      <span>Payout <strong>{formatTradeAmount(trade.payout, trade.currency)}</strong></span>
                      <span className={trade.profit > 0 ? "performance-positive" : trade.profit < 0 ? "performance-negative" : ""}>
                        P/L <strong>{formatTradeAmount(trade.profit, trade.currency)}</strong>
                      </span>
                    </div>
                    <small>Contract #{trade.contractId}</small>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <nav className="dashboard-bottom-nav" aria-label="Main navigation">
        <button type="button" className={`bottom-nav-item ${activeView === "home" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("home")} aria-current={activeView === "home" ? "page" : undefined} aria-controls="dashboard-home-view">
          <Home size={19} /><span>Home</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "signals" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("signals")} aria-current={activeView === "signals" ? "page" : undefined} aria-controls="dashboard-config-view">
          <Activity size={19} /><span>Configure</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "history" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("history")} aria-current={activeView === "history" ? "page" : undefined} aria-controls="dashboard-history-view">
          <Clock3 size={19} /><span>History</span>
        </button>
        <button type="button" className="bottom-nav-item" disabled aria-label="Settings coming soon">
          <Settings2 size={19} /><span>Settings</span>
        </button>
      </nav>
    </main>
  );
}