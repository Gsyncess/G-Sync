"use client";

import { ShieldCheck } from "lucide-react";

export type SignalConfig = {
  targetProfit: number;
  targetLoss: number;
  stakeAmount: number;
};

type SignalPageProps = {
  derivConnected: boolean;
  derivBusy: boolean;
  botRunning: boolean;
  botStatus: string;
  botConfig: SignalConfig;
  onConfigChange: (config: SignalConfig) => void;
  onStart: () => void;
  onStop: () => void;
  message?: string;
};

export function SignalPage({
  derivConnected,
  derivBusy,
  botRunning,
  botStatus,
  botConfig,
  onConfigChange,
  onStart,
  onStop,
  message,
}: SignalPageProps) {
  const updateField = (field: keyof SignalConfig, value: number) => {
    onConfigChange({
      ...botConfig,
      [field]: Number.isFinite(value) && value > 0 ? value : 1,
    });
  };

  return (
    <section className="market-panel" aria-label="Signal configuration page">
      <div className="market-toolbar">
        <div className="market-title-wrap">
          <div>
            <h2>Signals</h2>
            <p>Configure the bot strategy</p>
          </div>
        </div>
      </div>

      <div className="bot-controls" aria-label="Bot controls" style={{ display: "grid", gap: 14, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, color: "#dfe7f4", fontSize: 12 }}>
            <span>Target profit</span>
            <input
              type="number"
              min="1"
              step="1"
              value={botConfig.targetProfit}
              onChange={(event) => updateField("targetProfit", Number(event.target.value))}
              style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(15,23,42,0.75)", color: "white", padding: "8px 10px" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, color: "#dfe7f4", fontSize: 12 }}>
            <span>Target loss</span>
            <input
              type="number"
              min="1"
              step="1"
              value={botConfig.targetLoss}
              onChange={(event) => updateField("targetLoss", Number(event.target.value))}
              style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(15,23,42,0.75)", color: "white", padding: "8px 10px" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, color: "#dfe7f4", fontSize: 12 }}>
            <span>Stake amount</span>
            <input
              type="number"
              min="1"
              step="1"
              value={botConfig.stakeAmount}
              onChange={(event) => updateField("stakeAmount", Number(event.target.value))}
              style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(15,23,42,0.75)", color: "white", padding: "8px 10px" }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#93c5fd", fontSize: 12 }}>{botStatus}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="bot-start-button"
              onClick={onStart}
              disabled={!derivConnected || derivBusy || botRunning}
            >
              Configure
            </button>
            <button
              type="button"
              className="bot-stop-button"
              onClick={onStop}
              disabled={!botRunning}
            >
              Stop
            </button>
          </div>
        </div>
      </div>

      <div className="account-connect-row">
        <ShieldCheck size={15} />
        <div className="account-connect-content">
          <span>{derivConnected ? "Deriv account ready for strategy automation" : "Connect Deriv before configuring strategy"}</span>
          {message && <span className="deriv-account-message" role="status">{message}</span>}
        </div>
      </div>
    </section>
  );
}
