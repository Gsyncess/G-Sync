"use client";

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
            <p>Set trading limits</p>
          </div>
        </div>
      </div>

      <div className="signal-config">
        <div className="signal-config-grid">
          <label className="signal-config-field">
            <span>Target profit</span>
            <input
              className="signal-config-input"
              type="number"
              min="1"
              step="1"
              value={botConfig.targetProfit}
              onChange={(event) => updateField("targetProfit", Number(event.target.value))}
            />
          </label>
          <label className="signal-config-field">
            <span>Target loss</span>
            <input
              className="signal-config-input"
              type="number"
              min="1"
              step="1"
              value={botConfig.targetLoss}
              onChange={(event) => updateField("targetLoss", Number(event.target.value))}
            />
          </label>
          <label className="signal-config-field">
            <span>Stake amount</span>
            <input
              className="signal-config-input"
              type="number"
              min="1"
              step="1"
              value={botConfig.stakeAmount}
              onChange={(event) => updateField("stakeAmount", Number(event.target.value))}
            />
          </label>
        </div>
      </div>
    </section>
  );
}
