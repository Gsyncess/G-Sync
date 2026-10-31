"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export type SignalConfig = {
  targetProfit: number;
  targetLoss: number;
  stakeAmount: number;
};

type SignalPageProps = {
  botConfig: SignalConfig;
  onConfigChange: (config: SignalConfig) => void;
};

export function SignalPage({
  botConfig,
  onConfigChange,
}: SignalPageProps) {
  const [inputValues, setInputValues] = useState<Record<keyof SignalConfig, string>>({
    targetProfit: String(botConfig.targetProfit),
    targetLoss: String(botConfig.targetLoss),
    stakeAmount: String(botConfig.stakeAmount),
  });

  const updateField = (field: keyof SignalConfig, value: string) => {
    setInputValues((current) => ({ ...current, [field]: value }));
    const parsedValue = Number(value);
    if (value.trim() !== "" && Number.isFinite(parsedValue) && parsedValue > 0) {
      onConfigChange({ ...botConfig, [field]: parsedValue });
    }
  };

  const normalizeField = (field: keyof SignalConfig) => {
    const parsedValue = Number(inputValues[field]);
    setInputValues((current) => ({
      ...current,
      [field]: String(Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : botConfig[field]),
    }));
  };

  return (
    <section className="market-panel signal-config-panel" aria-label="Configuration page">
      <header className="signal-config-heading">
        <h2>Configure</h2>
        <p>Choose your session limits and starting stake.</p>
      </header>

      <div className="signal-config">
        <div className="signal-config-grid">
          <label className="signal-config-field">
            <span>Target profit</span>
            <small>Stop the bot when session profit reaches this amount.</small>
            <input
              className="signal-config-input"
              type="number"
              min="0.01"
              step="any"
              value={inputValues.targetProfit}
              onChange={(event) => updateField("targetProfit", event.target.value)}
              onBlur={() => normalizeField("targetProfit")}
            />
          </label>
          <label className="signal-config-field">
            <span>Target loss</span>
            <small>Stop the bot when session loss reaches this amount.</small>
            <input
              className="signal-config-input"
              type="number"
              min="0.01"
              step="any"
              value={inputValues.targetLoss}
              onChange={(event) => updateField("targetLoss", event.target.value)}
              onBlur={() => normalizeField("targetLoss")}
            />
          </label>
          <label className="signal-config-field">
            <span>Stake amount</span>
            <small>Starting stake for each trade.</small>
            <input
              className="signal-config-input"
              type="number"
              min="0.01"
              step="any"
              value={inputValues.stakeAmount}
              onChange={(event) => updateField("stakeAmount", event.target.value)}
              onBlur={() => normalizeField("stakeAmount")}
            />
          </label>
        </div>
      </div>
      <p className="signal-config-warning" role="note">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>Trading involves risk. Set limits carefully and only trade with funds you can afford to lose.</span>
      </p>
    </section>
  );
}
