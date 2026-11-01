# G-Sync

Mobile-first G-Sync sign-in and sign-up app, built with Next.js, React, Tailwind CSS, Framer Motion, Lucide, Express, Socket.IO, and Supabase.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in the environment variables described below before signing in. Open [http://localhost:3000](http://localhost:3000). On wider screens the app remains in a phone-sized preview; on mobile it fills the screen.

## Environment variables

Copy `.env.example` to `.env.local` for local development. Set the same values in the server's environment when deploying.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase publishable/anon key used by the sign-in client and server-side token verification. |
| `SUPABASE_SERVICE_ROLE_KEY` | Paid mode | Server-only Supabase service-role key. Required to persist profiles and payments and manage subscription entitlements. Never expose this key in browser code or a `NEXT_PUBLIC_` variable. |
| `SUBSCRIPTIONS_ENABLED` | No | `false` (default) allows free bot access. Set to `true` to require an active subscription and enable checkout. |
| `PLISIO_API_KEY` | Paid mode | Server-only Plisio Secret Key. Used to create invoices and verify Plisio callbacks. |
| `DERIV_APP_ID` | For Deriv account linking | Deriv application ID used for OAuth and live balance subscriptions. |
| `DERIV_REDIRECT_URI` | For Deriv account linking | Exact public callback URL registered in Deriv: `https://YOUR_HOST/api/deriv/oauth/callback`. |
| `CAPACITOR_SERVER_URL` | Android wrapper | Public HTTPS URL loaded by the Capacitor Android app. |
| `PORT` | Hosting platform | HTTP port. Usually provided by the host; defaults to `3000` locally. |

Supabase URL and anon key are required for authentication. The payment and subscription variables are only needed when paid mode is enabled. Keep all service-role and Plisio secrets server-side. Do not commit `.env.local` or production credentials.

## Supabase setup and automatic migrations

1. Create a Supabase project and copy its project URL and anon key into `.env.local` (or your deployment environment).
2. In GitHub, add these repository **Actions secrets** once: `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token), `SUPABASE_DB_PASSWORD` (the project's database password), and `SUPABASE_PROJECT_ID` (the project reference from its dashboard URL). The workflow uses them to connect only to the configured project.
3. Configure Supabase Auth email/password sign-in and sign-up for your project. For production, set the project's allowed site and redirect URLs to your deployed app.
4. For paid subscriptions, copy the Supabase **service-role** key into `SUPABASE_SERVICE_ROLE_KEY` on the server only. Never put it in a `NEXT_PUBLIC_` variable.

Database changes are versioned in [supabase/migrations/](supabase/migrations). When a migration is pushed to `main`, the GitHub Actions workflow applies pending migrations to the linked Supabase project automatically. You can also start the workflow from GitHub Actions with **Run workflow**. Do not edit the live database manually or re-run old SQL; add a new timestamped migration for each schema change. The initial migration is safe to apply to an existing installation of the previous schema.

The app records user profile details in `profiles`; subscription expiry in `bot_subscriptions`; and Plisio invoice/status data in `plisio_payments`. The migration preserves pre-existing payment records in `legacy_subscription_payments` and uses Plisio for new orders. Signup collects the user's first name and saves it to Supabase Auth metadata and their profile for display. Each profile receives a unique `G-` account ID, for example `G-6839387474588`, generated and stored by Supabase for new and existing users. Payment records are linked to the Supabase Auth user. Profile/payment server operations use the service-role key, and the client does not receive it.

## Bot subscriptions and in-app payments

### Free bot access

Set `SUBSCRIPTIONS_ENABLED=false` (or leave it unset) to allow bot access without checkout. No Plisio credentials are needed in this mode.

### Paid bot access

1. Create/configure a Plisio account, enable the cryptocurrencies and networks you want customers to use, and enable its White Label/custom API feature for in-app payment instructions.
2. Copy the Plisio Secret Key into the server environment as `PLISIO_API_KEY`.
3. Ensure the automatic Supabase migration workflow is configured and set `SUPABASE_SERVICE_ROLE_KEY` on the server.
4. Set `SUBSCRIPTIONS_ENABLED=true` only after all of the above is configured, then deploy/restart the app.

Each subscription costs **$5 USD for 12 hours**. The app loads currencies enabled for your account, creates a fixed-currency invoice that expires after 30 minutes, and displays the exact amount, address, and QR code in its own payment screens. Customers do not leave the app for a hosted checkout. During payment, the dashboard header and navigation are hidden, and the payment status stays pinned with a Settings back button. Expiry is taken from the invoice response, shown as a countdown, and expired pending records are removed from payment history and Supabase. The app displays an awaiting-payment status page with hidden success/failure return pages; the server verifies signed callbacks before updating payment status and automatically activating or extending the subscription. Browser redirects never grant access. The White Label/custom API feature is required because the regular invoice response only includes a hosted invoice URL.

Apply the Supabase migration before enabling subscriptions, then test invoice creation, the signed callback at `/api/plisio/callback`, and the return pages at `/payment/status`, `/payment/success`, and `/payment/failed`. The app derives its HTTPS callback and return URLs from the active public request host; no separate callback URL or Plisio IPN secret is required.

## Realtime and security

After sign-in, the client connects to Socket.IO using the latest Supabase access token. Realtime reconnects automatically with backoff and refreshes the auth token for each attempt; signing out closes the socket. The Node server validates the token with Supabase, scopes the connection to that user, and returns a realtime ping/pong for connection latency. Unauthenticated or mismatched-origin socket handshakes are rejected. Network interruptions and provider outages can still interrupt service; no internet connection can be guaranteed to stay online permanently.

Express applies Helmet security headers and a 120-request-per-15-minute limit to `/api` endpoints. The production Content Security Policy permits only the app and configured Supabase project for network requests. `GET /api/health` is intentionally public for Heroku health checks and returns no-store responses.

## Deriv account and trading setup

1. Create a Deriv application and register the exact redirect URI `https://YOUR_HOST/api/deriv/oauth/callback` in its settings.
2. Set `DERIV_APP_ID` and `DERIV_REDIRECT_URI` in the server environment. The redirect URI must use the same public host serving the app and HTTPS in production.
3. Deploy/restart the app, sign in, and use **Connect** to authorize a Deriv account. OAuth tokens are held in HttpOnly cookies and are not exposed to browser JavaScript.
4. Select a demo account first to test the bot and its risk limits before choosing a real account.

The market console reads public Deriv Volatility 100 (`R_100`) quotes. The bot calculates DPO(14) from each unique incoming tick (not minute candles) and evaluates zero-line crossovers for Rise (`CALL`) and Fall (`PUT`). It requires a warm-up series before trading. Signals are not guarantees of profit; users control the stake and session risk limits in Configure.

## Heroku deployment

Heroku supplies `PORT` automatically. In Heroku **Settings → Config Vars**, set the variables from the Environment variables section. Example for the common settings (replace all placeholders; never paste secrets into source control):

```bash
heroku config:set \
  NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY" \
  DERIV_APP_ID="YOUR_DERIV_APP_ID" \
  DERIV_REDIRECT_URI="https://YOUR_APP.herokuapp.com/api/deriv/oauth/callback"
```

For paid subscriptions, also configure `SUPABASE_SERVICE_ROLE_KEY`, `PLISIO_API_KEY`, and `SUBSCRIPTIONS_ENABLED=true`. Keep the flag false until the database schema and payment callback have been tested. The app runs from the custom Node server on `PORT`.

## Android app with Capacitor

The Android wrapper loads the deployed app from Heroku, so the phone needs an internet connection and the app's public Heroku URL. Install Android Studio with its Android SDK, then generate the Android project:

```bash
npm run android:add
```

Before syncing or building an installable app, set `CAPACITOR_SERVER_URL` to your deployed HTTPS app URL. For example:

```bash
CAPACITOR_SERVER_URL=https://your-app.herokuapp.com npm run android:sync
npm run android:open
```

Build an APK or Android App Bundle from Android Studio. After changing the deployed URL, run `android:sync` again with the updated `CAPACITOR_SERVER_URL` so the native app points to the right host.

## Trading dashboard

Once connected, the dashboard header shows the selected account balance and a dropdown to switch between eligible demo and real accounts. A server-side Deriv WebSocket subscription updates the selected balance, with periodic refresh as a fallback.