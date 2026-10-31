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
import DynamicDerivSmartChart from "@/components/deriv-smartchart";
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
  const [botStatus, setBotStatus] = useState("Ready");
  const [activeView, setActiveView] = useState<"home" | "signals">("home");
  const [botConfig, setBotConfig] = useState<SignalConfig>({
    targetProfit: 20,
    targetLoss: 10,
    stakeAmount: 5,
  });
  const derivMenuRef = useRef<HTMLDivElement>(null);
  const botStateRef = useRef({
    price: 100,
    emaFast: 100,
    emaSlow: 100,
    macd: 0,
    signal: 0,
    position: "flat" as "flat" | "long" | "short",
    entryPrice: 0,
  });

  const loadDerivSession = useCallback(async (showLoading = true) => {
    if (showLoading) setDerivBusy(true);
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
      if (showLoading) setDerivBusy(false);
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
    const refreshTimer = window.setInterval(() => {
      void loadDerivSession(false);
    }, 60_000);
    const refreshOnFocus = () => {
      void loadDerivSession(false);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
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

  useEffect(() => {
    if (!botRunning || !derivConnected) {
      setBotStatus("Ready");
      return;
    }

    const timer = window.setInterval(() => {
      const state = botStateRef.current;
      const drift = (Math.random() - 0.5) * 1.8;
      const nextPrice = Number(Math.max(0, state.price + drift).toFixed(2));
      const fastAlpha = 2 / (12 + 1);
      const slowAlpha = 2 / (26 + 1);
      state.emaFast = state.emaFast + fastAlpha * (nextPrice - state.emaFast);
      state.emaSlow = state.emaSlow + slowAlpha * (nextPrice - state.emaSlow);
      const macd = state.emaFast - state.emaSlow;
      const signalAlpha = 2 / (9 + 1);
      state.macd = macd;
      state.signal = state.signal === 0 ? macd : state.signal + signalAlpha * (macd - state.signal);
      state.price = nextPrice;

      const direction = state.macd > state.signal ? "long" : state.macd < state.signal ? "short" : "flat";

      if (state.position === "flat") {
        if (direction === "long") {
          state.position = "long";
          state.entryPrice = nextPrice;
          setBotStatus("Long set");
        } else if (direction === "short") {
          state.position = "short";
          state.entryPrice = nextPrice;
          setBotStatus("Short set");
        }
      } else if (state.position === "long") {
        const profit = (nextPrice - state.entryPrice) * botConfig.stakeAmount;
        const loss = (state.entryPrice - nextPrice) * botConfig.stakeAmount;
        if (profit >= botConfig.targetProfit || loss >= botConfig.targetLoss || direction !== "long") {
          state.position = "flat";
          state.entryPrice = 0;
          setBotStatus(profit >= botConfig.targetProfit ? "Profit target hit" : "Stop loss hit");
        }
      } else if (state.position === "short") {
        const profit = (state.entryPrice - nextPrice) * botConfig.stakeAmount;
        const loss = (nextPrice - state.entryPrice) * botConfig.stakeAmount;
        if (profit >= botConfig.targetProfit || loss >= botConfig.targetLoss || direction !== "short") {
          state.position = "flat";
          state.entryPrice = 0;
          setBotStatus(profit >= botConfig.targetProfit ? "Profit target hit" : "Stop loss hit");
        }
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [botConfig.stakeAmount, botConfig.targetLoss, botConfig.targetProfit, botRunning, derivConnected]);

  const disconnectDeriv = async () => {
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
    if (!derivConnected) return;
    setBotRunning(true);
    setBotStatus("Watching market");
  };

  const handleStopBot = () => {
    setBotRunning(false);
    setBotStatus("Ready");
    botStateRef.current = { price: 100, emaFast: 100, emaSlow: 100, macd: 0, signal: 0, position: "flat", entryPrice: 0 };
  };

  const accountSummary = derivAccounts
    .map(({ accountType, currency }) => [accountType, currency].filter(Boolean).join(" · "))
    .join(", ");
  const selectedDerivAccount = derivAccounts.find(
    (account) => account.accountId === selectedDerivAccountId,
  );
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
  const selectDerivAccount = (account: DerivAccount) => {
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
                disabled={derivBusy}
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
              disabled={derivBusy}
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
        {activeView === "signals" ? (
          <SignalPage
            derivConnected={derivConnected}
            derivBusy={derivBusy}
            botRunning={botRunning}
            botStatus={botStatus}
            botConfig={botConfig}
            onConfigChange={setBotConfig}
            onStart={handleStartBot}
            onStop={handleStopBot}
            message={derivMessage}
          />
        ) : (
          <>
            <div className="dashboard-greeting">
              <div>
                <p className="dashboard-eyebrow">TRADING OVERVIEW</p>
                <h1 id="dashboard-title">Your dashboard</h1>
                <p className="dashboard-subtitle">{email || "Your G-Sync account"}</p>
              </div>
              <span className="market-session"><span className="status-dot status-dot-waiting" /> Market watch</span>
            </div>

            <section className="market-panel" aria-label="Deriv SmartCharts market chart">
              <div className="market-toolbar">
                <div className="market-title-wrap">
                  <div>
                    <h2>Deriv SmartCharts</h2>
                    <p>Live market data · Volatility 100 Index</p>
                  </div>
                </div>
              </div>
              <DynamicDerivSmartChart />
            </section>

            <section className="performance-panel" aria-label="Trading performance">
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
                  <strong>--</strong>
                </div>
                <div className="performance-metric">
                  <span>W</span>
                  <strong>--</strong>
                </div>
                <div className="performance-metric">
                  <span>L</span>
                  <strong>--</strong>
                </div>
                <div className="performance-metric performance-rate">
                  <span>Rate</span>
                  <div className="rate-ring" aria-label="Win rate not available">
                    <span>--</span>
                  </div>
                </div>
              </div>
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
          </>
        )}
      </section>

      <nav className="dashboard-bottom-nav" aria-label="Main navigation">
        <button type="button" className={`bottom-nav-item ${activeView === "home" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("home")} aria-current={activeView === "home" ? "page" : undefined}>
          <Home size={19} /><span>Home</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "signals" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("signals")} aria-current={activeView === "signals" ? "page" : undefined}>
          <Activity size={19} /><span>Signals</span>
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