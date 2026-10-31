"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bot,
  ChevronDown,
  CircleHelp,
  Clock3,
  Home,
  LogOut,
  Settings2,
  ShieldCheck,
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

type SessionPerformance = {
  profit: number;
  wins: number;
  losses: number;
  trades: number;
};

type BotRuntime = {
  running: boolean;
  inFlight: boolean;
  unresolvedTrade: boolean;
  lastBias: MarketSignal["bias"];
  nextStake: number | null;
  sessionProfit: number;
};

type DashboardHomeProps = {
  email: string;
  socketOnline: boolean;
  onSignOut: () => void;
};

export function DashboardHome({ email, socketOnline, onSignOut }: DashboardHomeProps) {
  const [derivAccounts, setDerivAccounts] = useState<DerivAccount[]>([]);
  const [derivConnected, setDerivConnected] = useState(false);
  const [derivBusy, setDerivBusy] = useState(true);
  const [derivMessage, setDerivMessage] = useState("");
  const [selectedDerivAccountId, setSelectedDerivAccountId] = useState("");
  const [derivMenuOpen, setDerivMenuOpen] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const [botStatus, setBotStatus] = useState("Ready");
  const [marketFeedStatus, setMarketFeedStatus] = useState<"Connecting" | "Live" | "Reconnecting" | "Unavailable">("Connecting");
  const [activeView, setActiveView] = useState<"home" | "signals">("home");
  const [performance, setPerformance] = useState<SessionPerformance>({
    profit: 0,
    wins: 0,
    losses: 0,
    trades: 0,
  });
  const selectedDerivAccount = derivAccounts.find(
    (account) => account.accountId === selectedDerivAccountId,
  );
  const [botConfig, setBotConfig] = useState<SignalConfig>({
    targetProfit: 20,
    targetLoss: 10,
    stakeAmount: 5,
  });
  const derivMenuRef = useRef<HTMLDivElement>(null);
  const botConfigRef = useRef(botConfig);
  botConfigRef.current = botConfig;
  const selectedAccountRef = useRef<DerivAccount | undefined>(undefined);
  selectedAccountRef.current = selectedDerivAccount;
  const derivConnectedRef = useRef(derivConnected);
  derivConnectedRef.current = derivConnected;
  const botRuntimeRef = useRef<BotRuntime>({
    running: false,
    inFlight: false,
    unresolvedTrade: false,
    lastBias: "neutral",
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

  const handleFeedStatus = useCallback((status: typeof marketFeedStatus) => {
    setMarketFeedStatus(status);
    if (status !== "Live" && botRuntimeRef.current.running) {
      botRuntimeRef.current.running = false;
      setBotRunning(false);
      setBotStatus("Market feed interrupted. Bot stopped.");
    }
  }, []);

  const handleMarketSignal = useCallback((signal: MarketSignal) => {
    const runtime = botRuntimeRef.current;
    if (!signal.ready) {
      runtime.lastBias = "neutral";
      return;
    }
    const previousBias = runtime.lastBias;
    runtime.lastBias = signal.bias;
    if (!runtime.running || runtime.inFlight || signal.bias === "neutral" || signal.bias === previousBias) return;

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

    const contractType = signal.bias === "bullish" ? "CALL" : "PUT";
    const stake = runtime.nextStake ?? config.stakeAmount;
    if (stake > account.balance) {
      runtime.running = false;
      setBotRunning(false);
      setBotStatus("Next stake exceeds the selected account balance. Bot stopped.");
      return;
    }

    runtime.inFlight = true;
    setTradeInProgress(true);
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
        const result = await response.json() as {
          contractId?: unknown;
          profit?: unknown;
          error?: unknown;
          tradeMayBeOpen?: unknown;
        };
        if (!response.ok) {
          const tradeMayBeOpen = result.tradeMayBeOpen === true;
          runtime.inFlight = tradeMayBeOpen;
          runtime.unresolvedTrade = tradeMayBeOpen;
          runtime.running = false;
          setBotRunning(false);
          setBotStatus(
            tradeMayBeOpen
              ? "Trade result unconfirmed. Check Deriv open positions; bot stopped."
              : typeof result.error === "string" ? result.error : "Trade failed. Bot stopped.",
          );
          return;
        }

        if (typeof result.profit !== "number" || !Number.isFinite(result.profit)) {
          throw new Error("Deriv returned an invalid contract result.");
        }

        const profit = result.profit;
        runtime.sessionProfit += profit;
        if (profit > 0) {
          runtime.nextStake = config.stakeAmount;
        } else if (profit < 0) {
          runtime.nextStake = Number((stake * 1.5).toFixed(2));
        }
        setPerformance((current) => ({
          profit: current.profit + profit,
          wins: current.wins + (profit > 0 ? 1 : 0),
          losses: current.losses + (profit < 0 ? 1 : 0),
          trades: current.trades + 1,
        }));

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
        setBotStatus(
          error instanceof Error
            ? `${error.message} Check Deriv positions before restarting.`
            : "Trade result unconfirmed. Check Deriv positions before restarting.",
        );
      } finally {
        if (!runtime.unresolvedTrade) runtime.inFlight = false;
        setTradeInProgress(runtime.inFlight || runtime.unresolvedTrade);
      }
    })();
  }, []);

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
      setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
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
    runtime.lastBias = "neutral";
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
  const decidedTrades = performance.wins + performance.losses;
  const hasReliableWinRate = decidedTrades >= 5;
  const winRate = hasReliableWinRate
    ? Math.round((performance.wins / decidedTrades) * 100)
    : 0;
  const targetRange = botConfig.targetProfit + botConfig.targetLoss;
  const zeroPosition = (botConfig.targetLoss / targetRange) * 100;
  const currentPosition = Math.min(
    100,
    Math.max(0, ((performance.profit + botConfig.targetLoss) / targetRange) * 100),
  );
  const progressStart = Math.min(zeroPosition, currentPosition);
  const progressWidth = Math.abs(currentPosition - zeroPosition);
  const selectDerivAccount = (account: DerivAccount) => {
    if (botRuntimeRef.current.running || botRuntimeRef.current.inFlight) return;
    setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
    botRuntimeRef.current = {
      running: false,
      inFlight: false,
      unresolvedTrade: false,
      lastBias: "neutral",
      nextStake: null,
      sessionProfit: 0,
    };
    setSelectedDerivAccountId(account.accountId);
    window.localStorage.setItem("deriv-account-id", account.accountId);
    setDerivMenuOpen(false);
  };

  return (
    <main className="dashboard-shell">
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

      <section className="dashboard-content" aria-labelledby="dashboard-title">
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
                  <p>Session summary</p>
                </div>
                <button type="button" className="help-button" aria-label="Performance help" title="Performance updates after your Deriv account is connected">
                  <CircleHelp size={17} />
                </button>
              </div>
              <div className="performance-metrics">
                <div className="performance-metric">
                  <span>P/L</span>
                  <strong
                    key={`profit-${performance.trades}`}
                    className={performance.profit > 0 ? "performance-positive" : performance.profit < 0 ? "performance-negative" : ""}
                  >
                    {derivConnected ? formatPerformanceAmount(performance.profit) : "--"}
                  </strong>
                </div>
                <div className="performance-metric">
                  <span>W</span>
                  <strong key={`wins-${performance.trades}`}>{performance.wins}</strong>
                </div>
                <div className="performance-metric">
                  <span>L</span>
                  <strong key={`losses-${performance.trades}`}>{performance.losses}</strong>
                </div>
                <div className="performance-metric performance-rate">
                  <span>Rate (5+)</span>
                  <div
                    className="rate-ring"
                    title="Win rate is shown after at least five decided trades; breakeven trades are excluded."
                    style={{
                      background: `conic-gradient(#168c7a ${winRate}%, #e4eaf0 ${winRate}% 100%)`,
                    }}
                    aria-label={
                      hasReliableWinRate
                        ? `Win rate ${winRate} percent from ${decidedTrades} trades`
                        : `Win rate available after five decided trades; ${decidedTrades} completed`
                    }
                  >
                    <span>{hasReliableWinRate ? `${winRate}%` : "--"}</span>
                  </div>
                </div>
              </div>
              <div className="performance-progress">
                <div className="performance-progress-labels">
                  <span>Session target progress</span>
                  <span>{derivConnected ? formatPerformanceAmount(performance.profit) : "--"}</span>
                </div>
                <div
                  className={`performance-progress-track ${performance.profit < 0 ? "progress-negative" : "progress-positive"}`}
                  role="progressbar"
                  aria-label="Progress between session loss and profit targets"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={currentPosition}
                  aria-valuetext={derivConnected ? `${formatPerformanceAmount(performance.profit)} session result` : "Connect Deriv to track session progress"}
                >
                  <span className="performance-progress-zero" style={{ left: `${zeroPosition}%` }} />
                  <span
                    className="performance-progress-fill"
                    style={{ left: `${progressStart}%`, width: `${progressWidth}%` }}
                  />
                </div>
                <div className="performance-progress-targets">
                  <span>−{formatPerformanceAmount(botConfig.targetLoss)}</span>
                  <span>Profit target {formatPerformanceAmount(botConfig.targetProfit)}</span>
                </div>
              </div>
              <p className="performance-trade-count">{performance.trades} completed bot trade{performance.trades === 1 ? "" : "s"} this session</p>
              <div className="account-connect-row">
                <ShieldCheck size={15} />
                <div className="account-connect-content">
                  <span>
                    {derivBusy
                      ? "Checking Deriv connection…"
                      : derivConnected
                        ? `Deriv connected${accountSummary ? ` · ${accountSummary}` : ""}`
                        : "Connect Deriv to authorize your account"}
                  </span>
                  {derivMessage && <span className="deriv-account-message" role="status">{derivMessage}</span>}
                </div>
              </div>
            </section>

            <div className="home-bot-controls" aria-label="Bot controls">
              <div className="bot-trade-progress" role="status" aria-live="polite">
                <div className="bot-trade-progress-heading">
                  <span>{tradeInProgress ? "Trade in progress · 5-tick contract" : "Open trade progress"}</span>
                  <span>{tradeInProgress ? "In progress" : "No open trade"}</span>
                </div>
                <div
                  className={`bot-trade-progress-track ${tradeInProgress ? "bot-trade-progress-active" : ""}`}
                  role="progressbar"
                  aria-label="5-tick trade progress"
                  aria-valuetext={tradeInProgress ? "Trade is being processed and awaiting settlement" : "No open trade"}
                >
                  <span />
                </div>
                <span className="home-bot-status">{botStatus}</span>
              </div>
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
      </section>

      <nav className="dashboard-bottom-nav" aria-label="Main navigation">
        <button type="button" className={`bottom-nav-item ${activeView === "home" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("home")} aria-current={activeView === "home" ? "page" : undefined} aria-controls="dashboard-home-view">
          <Home size={19} /><span>Home</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "signals" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("signals")} aria-current={activeView === "signals" ? "page" : undefined} aria-controls="dashboard-config-view">
          <Activity size={19} /><span>Configure</span>
        </button>
        <button type="button" className="bottom-nav-item" disabled aria-label="History coming soon">
          <Clock3 size={19} /><span>History</span>
        </button>
        <button type="button" className="bottom-nav-item" disabled aria-label="Settings coming soon">
          <Settings2 size={19} /><span>Settings</span>
        </button>
      </nav>
    </main>
  );
}