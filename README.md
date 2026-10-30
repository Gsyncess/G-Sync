# G-Sync

Mobile-first G-Sync sign-in and sign-up app, built with Next.js, React, Tailwind CSS, Framer Motion, Lucide, Express, Socket.IO, and Supabase.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On wider screens the app remains in a phone-sized preview; on mobile it fills the screen.

## Supabase setup

Add your project URL and anon key to `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor to create the profiles table, row-level policies, and new-user profile trigger. Email/password sign-up, sign-in, and password reset use Supabase Auth.

## Realtime and security

After sign-in, the client connects to Socket.IO using the Supabase access token. The Node server validates the token with Supabase, scopes the connection to that user, and returns a realtime ping/pong for connection latency. The socket disconnects on sign-out and reconnects with refreshed sessions. Unauthenticated or mismatched-origin socket handshakes are rejected.

Express applies Helmet security headers and a 120-request-per-15-minute limit to `/api` endpoints. The production Content Security Policy permits only the app and configured Supabase project for network requests. `GET /api/health` is intentionally public for Heroku health checks and returns no-store responses.

## Heroku deployment

Heroku needs `PORT` and the Supabase environment variables set in the app config. Use the Heroku dashboard or CLI:

```bash
heroku config:set PORT=3000 NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

The app runs from the custom Node server on `PORT`; configure both Supabase variables in Heroku for authentication and authenticated realtime connections.

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

After Supabase sign-in, the home dashboard loads Deriv SmartCharts with live market data. Set `NEXT_PUBLIC_DERIV_APP_ID` to an app ID registered with Deriv to enable the chart. The performance metrics remain empty and bot controls stay disabled until Deriv account authorization and the trading strategy are implemented; the dashboard does not place trades.