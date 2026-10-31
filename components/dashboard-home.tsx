"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CircleHelp,
  Clock3,
  Home,
  LogOut,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { DerivSmartChart } from "@/components/deriv-smartchart";

type DerivAccount = {
  accountType: string;
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

  const loadDerivSession = useCallback(async () => {
    setDerivBusy(true);
    try {
      const response = await fetch("/api/deriv/session", { cache: "no-store" });
      const result = (await response.json()) as DerivSessionResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not check the Deriv connection.");
      setDerivConnected(result.connected === true);
      setDerivAccounts(result.accounts ?? []);
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

  const disconnectDeriv = async () => {
    setDerivBusy(true);
    setDerivMessage("");
    try {
      const response = await fetch("/api/deriv/session/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Could not disconnect the Deriv account.");
      setDerivConnected(false);
      setDerivAccounts([]);
      setDerivMessage("Your Deriv account has been disconnected.");
    } catch (error) {
      setDerivMessage(error instanceof Error ? error.message : "Could not disconnect the Deriv account.");
    } finally {
      setDerivBusy(false);
    }
  };

  const accountSummary = derivAccounts
    .map(({ accountType, currency }) => [accountType, currency].filter(Boolean).join(" · "))
    .join(", ");

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
          {derivConnected ? (
            <button
              type="button"
              className="deriv-header-button"
              onClick={() => void disconnectDeriv()}
              disabled={derivBusy}
              title={accountSummary ? `Disconnect Deriv (${accountSummary})` : "Disconnect Deriv account"}
              aria-label="Disconnect Deriv account"
            >
              {derivBusy ? "…" : "Connected"}
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
                <p>Live market data · choose a symbol in the chart</p>
              </div>
            </div>
          </div>
          <DerivSmartChart />
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

        <div className="bot-controls" aria-label="Bot controls">
          <button type="button" className="bot-start-button" disabled title="Connect and authorize a Deriv account first">Start bot</button>
          <button type="button" className="bot-stop-button" disabled title="No bot session is running">Stop</button>
        </div>
        <p className="dashboard-disclaimer">Trading controls unlock after account authorization and strategy setup.</p>
      </section>

      <nav className="dashboard-bottom-nav" aria-label="Main navigation">
        <button type="button" className="bottom-nav-item bottom-nav-active" aria-current="page">
          <Home size={19} /><span>Home</span>
        </button>
        <button type="button" className="bottom-nav-item" disabled aria-label="Signals coming soon">
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