Update the existing G-Sync automated trading bot. Preserve the current app UI, background colors, console card colors, layout, and all working features.

1. Automated Trading Strategy

- Platform: Deriv Rise and Fall.
- Contract duration: 1 minute.
- Analysis timeframe: 1-minute candles.
- Indicators: EMA 5, EMA 14, and Williams Fractal.
- Rise setup: EMA 5 crosses above EMA 14, supported by a confirmed lower fractal.
- Fall setup: EMA 5 crosses below EMA 14, supported by a confirmed upper fractal.
- Require confirmation before entering trades. Handle fractal confirmation delays correctly; do not use unconfirmed fractals.
- Keep the strategy configurable internally, and test it on a Deriv demo account before live deployment.

2. Trading Console
Display concise, real-time messages:

- Trading engine initialized
- Deriv connection established
- Market conditions evaluated
- Monitoring market activity
- Trading opportunity detected
- Executing trade
- Trade completed
- Contract settled
- Risk limit reached
- Trading temporarily paused

3. Console Styling

- Font sizes: timestamps 10–11px, categories 9–10px, messages 11–12px.
- Apply dynamic colors only to log indicators, category labels, and status values.
- Green: success; blue: system; cyan: monitoring; amber: signals; orange: warnings; red: errors/losses; grey: paused.
- Keep the existing app background and console card colors unchanged.
- Do not reveal indicator names, indicator values, crossover details, or internal strategy rules in the UI or logs.

4. Implementation
Use the existing Node.js backend and Deriv integration. Validate signals, prevent duplicate trades, handle API errors, and display actual trade results. Do not fabricate events or modify unrelated application features.

Make only the necessary changes and report which files were modified.
