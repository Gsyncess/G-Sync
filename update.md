You are helping me fix a Deriv SmartChart integration in a React app. Problem:
- The app shows “Deriv chart unavailable”.
- Error: “can't access property ReactCurrentOwner, a.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED is undefined”.
- The app supports multiple Deriv users through OAuth 2.0.
- The chart should display Deriv market data. Please do the following:
1. Inspect package.json, the React version, the SmartChart package version, and the build tool.
2. Check for multiple or incompatible React versions in the dependency tree.
3. Check that React and React DOM use the same compatible version.
4. Check the SmartChart import and setup code.
5. Check whether the chart package is compatible with the current React version and bundler.
6. Check for incorrect server-side rendering, lazy loading, or duplicate React instances.
7. Keep OAuth tokens out of logs, source code, and error messages.
8. Use the public Deriv WebSocket connection for public chart data when authentication is not required:
https://api.derivws.com/trading/v1/options/ws/public
9. Do not change trading or OAuth logic unless it is required for the chart.
10. If SmartChart is not compatible with the current setup, explain the exact compatibility problem and suggest a supported chart integration using Deriv market-data subscriptions. Before changing files, explain the likely cause. Then provide:
- The files that need changes
- The exact dependency or import changes
- The corrected chart setup
- The commands to install or update dependencies
- A short test plan
- Any information still needed from me, such as React version, SmartChart version, or build tool. Relevant Deriv API guides:
- https://developers.deriv.com/llms/oauth.md
- https://developers.deriv.com/llms/ws-public.md
- https://developers.deriv.com/llms/ticks.md
