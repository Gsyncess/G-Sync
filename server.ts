import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import next from "next";
import { createClient } from "@supabase/supabase-js";
import { Server as SocketServer } from "socket.io";
import {
  DerivTradeError,
  executeDerivOneMinuteTrade,
  getDerivTradingOtpUrl,
  subscribeDerivBalance,
} from "./lib/deriv-trading";
import { fetchRecentDerivCandles } from "./lib/deriv-market-data";
import { DEFAULT_STRATEGY_CONFIG, evaluateDerivStrategy } from "./lib/deriv-strategy";

const development = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const derivAppId = (process.env.DERIV_APP_ID ?? process.env.NEXT_PUBLIC_DERIV_APP_ID)?.trim();
const derivRedirectUri = process.env.DERIV_REDIRECT_URI?.trim();
const subscriptionsEnabled = process.env.SUBSCRIPTIONS_ENABLED?.trim().toLowerCase() === "true";
const plisioApiKey = process.env.PLISIO_API_KEY?.trim();
const SUBSCRIPTION_PRICE_USD = 5;
const SUBSCRIPTION_DURATION_HOURS = 12;
const PLISIO_INVOICE_EXPIRY_MINUTES = 30;
const nextApp = next({ dev: development });
const nextHandler = nextApp.getRequestHandler();
const supabaseAuth =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      })
    : null;
const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      })
    : null;

function parsePlisioTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const numericValue = Number(value);
  const timestamp = Number.isFinite(numericValue)
    ? numericValue > 1_000_000_000_000
      ? numericValue
      : numericValue * 1000
    : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function deleteExpiredPlisioPayments(userId?: string) {
  if (!supabaseAdmin) return { error: null };
  let query = supabaseAdmin
    .from("plisio_payments")
    .delete()
    .is("activated_at", null)
    .in("payment_status", ["new", "pending"])
    .lte("expires_at", new Date().toISOString());
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  return { error };
}

const securityHeaders = {
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: development
    ? false
    : {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'", ...(supabaseUrl ? [new URL(supabaseUrl).origin] : []), "wss:"],
          fontSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", "data:", "blob:"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
};

const oauthCookiePath = "/api/deriv/oauth/";
const derivCookiePath = "/api/deriv";
const activeDerivTrades = new Set<string>();
const activeDerivUsers = new Set<string>();
const processedDerivSignals = new Map<string, number>();

function claimDerivSignal(key: string) {
  const now = Date.now();
  for (const [signalKey, expiresAt] of processedDerivSignals) {
    if (expiresAt <= now) processedDerivSignals.delete(signalKey);
  }
  if (processedDerivSignals.has(key)) return false;
  processedDerivSignals.set(key, now + 5 * 60_000);
  return true;
}

async function authenticateSupabaseRequest(request: express.Request) {
  if (!supabaseAuth) return null;
  const accessToken = request.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return null;
  const { data, error } = await supabaseAuth.auth.getUser(accessToken);
  return error ? null : data.user;
}

function verifyPlisioCallback(body: Record<string, unknown>) {
  const signature = body.verify_hash;
  if (!plisioApiKey || typeof signature !== "string" || !/^[a-f\d]{40}$/i.test(signature)) return false;

  const entries = Object.entries(body)
    .filter(([key]) => key !== "verify_hash")
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([, value]) => value !== null && !["string", "number", "boolean"].includes(typeof value))) {
    return false;
  }
  const signedData = entries.map(([, value]) => value === null ? "" : String(value)).join("|");
  const expected = createHmac("sha1", plisioApiKey).update(signedData).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type PlisioCurrency = {
  id: string;
  name: string;
  network: string | null;
};

async function getPlisioCurrencies(): Promise<PlisioCurrency[]> {
  if (!plisioApiKey) throw new Error("Payment gateway is not configured.");
  const params = new URLSearchParams({ api_key: plisioApiKey });
  const response = await fetch(`https://api.plisio.net/api/v1/currencies/USD?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error("Could not load supported payment currencies.");
  }
  const providerResult = payload as Record<string, unknown>;
  if (providerResult.status !== "success") {
    throw new Error("Could not load supported payment currencies.");
  }
  const responseData = providerResult.data;
  const currencyCollection = responseData && typeof responseData === "object" && !Array.isArray(responseData)
    ? ((responseData as Record<string, unknown>).currencies ?? responseData)
    : responseData;
  const currencies = Array.isArray(currencyCollection)
    ? currencyCollection
    : currencyCollection && typeof currencyCollection === "object"
      ? Object.values(currencyCollection)
      : [];
  const normalized = currencies.flatMap((entry): PlisioCurrency[] => {
    if (typeof entry === "string" && /^[A-Z0-9_]{2,20}$/.test(entry)) {
      return [{ id: entry, name: entry.replaceAll("_", " "), network: null }];
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const currency = entry as Record<string, unknown>;
    const id = currency.cid ?? currency.psys_cid ?? currency.id ?? currency.code;
    if (typeof id !== "string" || !/^[A-Z0-9_]{2,20}$/.test(id)) return [];
    if (currency.enabled === false || currency.is_enabled === false || currency.available === false) return [];
    const nameValue = currency.name ?? currency.full_name ?? currency.title;
    const networkValue = currency.network ?? currency.blockchain ?? currency.chain;
    return [{
      id,
      name: typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : id.replaceAll("_", " "),
      network: typeof networkValue === "string" && networkValue.trim() ? networkValue.trim() : null,
    }];
  });
  const unique = [...new Map(normalized.map((currency) => [currency.id, currency])).values()];
  if (unique.length === 0) throw new Error("No supported payment currencies were returned.");
  return unique;
}

async function getSubscriptionExpiry(userId: string) {
  if (!supabaseAdmin) return { expiresAt: null, error: "Subscription storage is not configured." };
  const { data, error } = await supabaseAdmin
    .from("bot_subscriptions")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { expiresAt: null, error: "Could not load subscription status." };
  return {
    expiresAt: typeof data?.expires_at === "string" ? data.expires_at : null,
    error: null,
  };
}

function appendCookie(
  response: express.Response,
  name: string,
  value: string,
  path: string,
  maxAgeSeconds: number,
) {
  const attributes = [
    `${name}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  response.append("Set-Cookie", attributes.join("; "));
}

function clearCookie(response: express.Response, name: string, path: string) {
  const attributes = [
    `${name}=`,
    `Path=${path}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  response.append("Set-Cookie", attributes.join("; "));
}

function readCookie(request: express.Request, name: string) {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

function readEncodedCookie(request: express.Request, name: string) {
  const value = readCookie(request, name);
  return value ? Buffer.from(value, "base64url").toString("utf8") : null;
}

async function refreshDerivAccessToken(request: express.Request, response: express.Response) {
  const refreshToken = readEncodedCookie(request, "deriv_refresh_token");
  if (!refreshToken) return null;

  try {
    const tokenResponse = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: derivAppId ?? "",
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      clearCookie(response, "deriv_access_token", derivCookiePath);
      clearCookie(response, "deriv_refresh_token", derivCookiePath);
      return null;
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof tokenData.access_token !== "string") return null;

    const nextExpiresIn = typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in)
      ? tokenData.expires_in
      : 3600;
    const nextRefresh = typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : refreshToken;
    const encodedAccessToken = Buffer.from(tokenData.access_token).toString("base64url");
    const encodedRefreshToken = Buffer.from(nextRefresh).toString("base64url");
    appendCookie(response, "deriv_access_token", encodedAccessToken, derivCookiePath, Math.max(1, Math.floor(nextExpiresIn)));
    appendCookie(response, "deriv_refresh_token", encodedRefreshToken, derivCookiePath, 30 * 24 * 60 * 60);
    return tokenData.access_token;
  } catch (error) {
    console.error("Could not refresh Deriv token.", error);
    return null;
  }
}

function coerceDerivBalance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return null;
}

function collectDerivAccountEntries(payload: unknown): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const hasAccountId = typeof record.account_id === "string" || typeof record.accountId === "string" || typeof record.loginid === "string";
    if (hasAccountId) {
      results.push(record);
      return;
    }
    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };
  visit(payload);
  return results;
}

type NormalizedDerivAccount = {
  accountId: string;
  accountType: "demo" | "real";
  balance: number;
  currency: string;
};

function normalizeDerivAccounts(payload: unknown): NormalizedDerivAccount[] {
  const records = collectDerivAccountEntries(payload);
  return records.flatMap((account) => {
    const accountId =
      typeof account.account_id === "string"
        ? account.account_id
        : typeof account.accountId === "string"
          ? account.accountId
          : typeof account.loginid === "string"
            ? account.loginid
            : "";
    const accountType =
      typeof account.account_type === "string"
        ? account.account_type
        : typeof account.accountType === "string"
          ? account.accountType
          : typeof account.type === "string"
            ? account.type
            : "";
    const balance = coerceDerivBalance(account.balance);
    const currency =
      typeof account.currency === "string" && account.currency.trim() !== ""
        ? account.currency.toUpperCase()
        : "";
    const normalizedAccountType = accountType.toLowerCase();
    const status = typeof account.status === "string" ? account.status.toLowerCase() : "";

    if (
      !accountId ||
      (normalizedAccountType !== "demo" && normalizedAccountType !== "real") ||
      balance === null ||
      !currency ||
      status === "inactive"
    ) {
      return [];
    }

    const normalizedType: "demo" | "real" = normalizedAccountType === "demo" ? "demo" : "real";
    return [{
      accountId,
      accountType: normalizedType,
      balance,
      currency,
    }];
  });
}

async function startServer() {
  await nextApp.prepare();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet(securityHeaders));
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 120,
      skip: (request) => request.path === "/deriv/bot-trade",
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again shortly." },
    }),
  );

  const server = createServer(app);
  const io = new SocketServer(server, {
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 25000,
    pingTimeout: 20000,
    perMessageDeflate: false,
  });

  io.use(async (socket, nextSocket) => {
    const origin = socket.handshake.headers.origin;
    const host = socket.handshake.headers.host;
    if (origin && host) {
      try {
        if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) {
          nextSocket(new Error("Origin not allowed"));
          return;
        }
      } catch {
        nextSocket(new Error("Invalid origin"));
        return;
      }
    }

    const accessToken = socket.handshake.auth?.accessToken;
    if (!supabaseAuth || typeof accessToken !== "string") {
      nextSocket(new Error("Authentication required"));
      return;
    }

    try {
      const { data, error } = await supabaseAuth.auth.getUser(accessToken);
      if (error || !data.user) {
        nextSocket(new Error("Invalid session"));
        return;
      }
      socket.data.userId = data.user.id;
      nextSocket();
    } catch {
      nextSocket(new Error("Authentication unavailable"));
    }
  });

  app.get("/api/health", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({ status: "ok", service: "g-sync", realtime: "socket.io" });
  });

  app.get("/api/account", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({
        error: supabaseAuth ? "Sign in to load your profile." : "Supabase authentication is not configured.",
      });
      return;
    }

    const metadata = user.user_metadata ?? {};
    const firstName = [
      metadata.first_name,
      metadata.given_name,
      metadata.full_name,
      metadata.name,
      metadata.username,
      user.email?.split("@")[0],
    ].find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim()
      .split(/\s+/)[0] ?? "User";
    const username = firstName;
    const displayName = firstName;

    if (supabaseAdmin) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: user.id,
          email: user.email ?? null,
          username,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
      if (profileError) {
        console.error("Could not save the authenticated user's profile.", profileError);
        response.status(503).json({ error: "Could not save your profile to Supabase." });
        return;
      }
    }

    let expiresAt: string | null = null;
    if (subscriptionsEnabled) {
      const subscription = await getSubscriptionExpiry(user.id);
      if (subscription.error) {
        response.status(503).json({ error: subscription.error });
        return;
      }
      expiresAt = subscription.expiresAt;
    }
    response.json({
      accountId: user.id,
      email: user.email ?? "",
      username,
      displayName,
      subscription: {
        enabled: subscriptionsEnabled,
        expiresAt,
        active: !subscriptionsEnabled || (expiresAt !== null && Date.parse(expiresAt) > Date.now()),
      },
    });
  });

  app.post(
    "/api/plisio/callback",
    express.json({ limit: "32kb" }),
    express.urlencoded({ extended: false, limit: "32kb" }),
    async (request, response) => {
      response.set("Cache-Control", "no-store");
      if (!supabaseAdmin || !plisioApiKey) {
        response.status(503).json({ error: "Plisio notifications are not configured." });
        return;
      }
      const body: unknown = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        response.status(400).json({ error: "Invalid payment notification." });
        return;
      }
      const notification = body as Record<string, unknown>;
      if (!verifyPlisioCallback(notification)) {
        response.status(401).json({ error: "Invalid payment notification signature." });
        return;
      }

      const paymentId = notification.txn_id;
      const orderId = notification.order_number;
      const paymentStatus = notification.status;
      if (typeof paymentId !== "string" || typeof orderId !== "string" || typeof paymentStatus !== "string") {
        response.status(400).json({ error: "Payment notification is missing required fields." });
        return;
      }
      if (!/^[a-z_]{1,40}$/i.test(paymentStatus)) {
        response.status(400).json({ error: "Unknown payment status." });
        return;
      }

      const { data: existingPayment, error: paymentLookupError } = await supabaseAdmin
        .from("plisio_payments")
        .select("payment_id, order_id, price_amount, price_currency, payment_status, payment_amount, payment_currency")
        .eq("payment_id", paymentId)
        .maybeSingle();
      if (paymentLookupError) {
        console.error("Could not look up the Plisio payment notification.", paymentLookupError);
        response.status(503).json({ error: "Could not verify the payment notification." });
        return;
      }
      const sourceAmount = notification.source_amount;
      const sourceCurrency = notification.source_currency;
      if (
        !existingPayment ||
        existingPayment.order_id !== orderId ||
        (sourceAmount !== undefined &&
          (!Number.isFinite(Number(sourceAmount)) || Number(sourceAmount) !== Number(existingPayment.price_amount))) ||
        (typeof sourceCurrency === "string" &&
          sourceCurrency.toUpperCase() !== existingPayment.price_currency.toUpperCase())
      ) {
        response.status(400).json({ error: "Payment notification does not match an app payment." });
        return;
      }

      const nextStatus = existingPayment.payment_status === "completed"
        ? "completed"
        : paymentStatus.toLowerCase();
      const amountValue = Number(notification.amount);
      const currencyValue = notification.psys_cid ?? notification.currency;
      const { error: paymentUpdateError } = await supabaseAdmin
        .from("plisio_payments")
        .update({
          payment_status: nextStatus,
          payment_amount: Number.isFinite(amountValue) && amountValue >= 0
            ? amountValue
            : existingPayment.payment_amount,
          payment_currency: typeof currencyValue === "string"
            ? currencyValue
            : existingPayment.payment_currency,
          callback_data: notification,
          updated_at: new Date().toISOString(),
        })
        .eq("payment_id", paymentId)
        .eq("order_id", orderId);
      if (paymentUpdateError) {
        console.error("Could not update the Plisio payment status.", paymentUpdateError);
        response.status(503).json({ error: "Could not save the payment status." });
        return;
      }

      if (nextStatus === "completed") {
        const { error: activationError } = await supabaseAdmin.rpc(
          "activate_gsync_subscription_from_plisio_payment",
          { p_payment_id: paymentId },
        );
        if (activationError) {
          console.error("Could not activate a paid bot subscription.", activationError);
          response.status(503).json({ error: "Could not activate the paid subscription." });
          return;
        }
      }
      response.json({ received: true });
    },
  );

  app.get("/api/subscription/currencies", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!subscriptionsEnabled || !plisioApiKey) {
      response.status(404).json({ error: "Subscription payments are unavailable." });
      return;
    }
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({ error: "Sign in before choosing a payment currency." });
      return;
    }
    try {
      response.json({ currencies: await getPlisioCurrencies() });
    } catch (error) {
      console.error("Could not load supported payment currencies.", error);
      response.status(503).json({ error: "Could not load payment options. Please try again." });
    }
  });

  app.post("/api/subscription/payments", express.json({ limit: "4kb" }), async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!subscriptionsEnabled) {
      response.status(404).json({ error: "Subscriptions are currently disabled." });
      return;
    }
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({ error: "Sign in before purchasing a subscription." });
      return;
    }
    if (!supabaseAdmin || !plisioApiKey) {
      response.status(503).json({ error: "In-app subscription payments are not fully configured." });
      return;
    }
    const currentSubscription = await getSubscriptionExpiry(user.id);
    if (currentSubscription.error) {
      response.status(503).json({ error: currentSubscription.error });
      return;
    }

    const requestedCurrency = request.body?.currency;
    if (typeof requestedCurrency !== "string" || !/^[A-Z0-9_]{2,20}$/.test(requestedCurrency)) {
      response.status(400).json({ error: "Choose a supported payment currency." });
      return;
    }
    let supportedCurrencies: PlisioCurrency[];
    try {
      supportedCurrencies = await getPlisioCurrencies();
    } catch (error) {
      console.error("Could not validate the requested payment currency.", error);
      response.status(503).json({ error: "Could not validate the selected payment option." });
      return;
    }
    const currency = supportedCurrencies.find((option) => option.id === requestedCurrency);
    if (!currency) {
      response.status(400).json({ error: "Choose a supported payment currency." });
      return;
    }

    const host = request.get("host");
    if (!host || (process.env.NODE_ENV === "production" && request.protocol !== "https")) {
      response.status(503).json({ error: "A secure public app URL is required to start payment." });
      return;
    }
    const appOrigin = `${request.protocol}://${host}`;
    const orderId = `gs-${randomBytes(16).toString("hex")}`;
    const callbackUrl = new URL("/api/plisio/callback", appOrigin).toString();
    const successUrl = new URL(`/payment/success?order_id=${encodeURIComponent(orderId)}`, appOrigin).toString();
    const failedUrl = new URL(`/payment/failed?order_id=${encodeURIComponent(orderId)}`, appOrigin).toString();
    const customerEmail = user.email ?? "";
    const invoiceParams = new URLSearchParams({
      api_key: plisioApiKey,
      source_currency: "USD",
      source_amount: String(SUBSCRIPTION_PRICE_USD),
      currency: currency.id,
      allowed_psys_cids: currency.id,
      order_number: orderId,
      order_name: "G-Sync bot subscription",
      description: `G-Sync ${SUBSCRIPTION_DURATION_HOURS}-hour bot subscription`,
      callback_url: callbackUrl,
      success_invoice_url: successUrl,
      fail_invoice_url: failedUrl,
      expire_min: String(PLISIO_INVOICE_EXPIRY_MINUTES),
      ...(customerEmail ? { email: customerEmail } : {}),
    });

    let providerResponse: Response;
    try {
      providerResponse = await fetch(`https://api.plisio.net/api/v1/invoices/new?${invoiceParams}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.error("Could not create an in-app Plisio invoice.", error);
      response.status(503).json({ error: "Could not start payment. Please try again." });
      return;
    }
    const providerPayload: unknown = await providerResponse.json().catch(() => null);
    if (!providerResponse.ok || !providerPayload || typeof providerPayload !== "object") {
      console.error("Plisio rejected an in-app invoice request.", { status: providerResponse.status });
      response.status(502).json({ error: "Could not create secure payment instructions. Please try again." });
      return;
    }
    const payload = providerPayload as Record<string, unknown>;
    const paymentData = payload.data;
    if (payload.status !== "success" || !paymentData || typeof paymentData !== "object") {
      console.error("Plisio returned an unsuccessful invoice response.", { status: providerResponse.status });
      response.status(502).json({ error: "Could not create secure payment instructions. Please try again." });
      return;
    }
    const invoice = paymentData as Record<string, unknown>;
    const paymentId = invoice.txn_id;
    const paymentAddress = invoice.wallet_hash ?? invoice.payment_address;
    const amountValue = Number(invoice.amount ?? invoice.invoice_total_sum);
    const paymentCurrency = invoice.psys_cid ?? invoice.currency;
    const qrCode = invoice.qr_code;
    if (
      typeof paymentId !== "string" ||
      !paymentId ||
      typeof paymentAddress !== "string" ||
      paymentAddress.length === 0 ||
      !Number.isFinite(amountValue) ||
      amountValue <= 0 ||
      typeof paymentCurrency !== "string" ||
      paymentCurrency.toUpperCase() !== currency.id
    ) {
      console.error("Plisio returned incomplete invoice instructions.");
      response.status(503).json({ error: "In-app payment is unavailable for this account. Contact support." });
      return;
    }

    const createdAt = new Date().toISOString();
    const expiresAt = (
      parsePlisioTimestamp(invoice.expire_utc) ??
      new Date(Date.parse(createdAt) + PLISIO_INVOICE_EXPIRY_MINUTES * 60_000)
    ).toISOString();
    const { error: insertError } = await supabaseAdmin
      .from("plisio_payments")
      .insert({
        payment_id: paymentId,
        user_id: user.id,
        order_id: orderId,
        customer_email: customerEmail || null,
        price_amount: SUBSCRIPTION_PRICE_USD,
        price_currency: "USD",
        payment_amount: amountValue,
        payment_currency: paymentCurrency,
        payment_address: paymentAddress,
        qr_code: typeof qrCode === "string" && /^data:image\/(?:png|jpeg);base64,/.test(qrCode) ? qrCode : null,
        payment_status: typeof invoice.status === "string" ? invoice.status : "new",
        created_at: createdAt,
        expires_at: expiresAt,
        updated_at: createdAt,
      });
    if (insertError) {
      console.error("Could not save the Plisio payment.", insertError);
      response.status(503).json({ error: "Could not save payment status. Please contact support before paying." });
      return;
    }

    response.status(201).json({
      paymentId,
      orderId,
      priceAmount: SUBSCRIPTION_PRICE_USD,
      priceCurrency: "USD",
      payAmount: amountValue,
      payCurrency: paymentCurrency,
      payAddress: paymentAddress,
      qrCode: typeof qrCode === "string" && /^data:image\/(?:png|jpeg);base64,/.test(qrCode) ? qrCode : null,
      status: typeof invoice.status === "string" ? invoice.status : "new",
      expiresAt,
    });
  });

  app.get("/api/subscription/payments", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!subscriptionsEnabled || !supabaseAdmin) {
      response.status(404).json({ error: "Subscription payment history is unavailable." });
      return;
    }
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({ error: "Sign in to view payment history." });
      return;
    }

    const { error: cleanupError } = await deleteExpiredPlisioPayments(user.id);
    if (cleanupError) {
      console.error("Could not remove expired subscription payments.", cleanupError);
      response.status(503).json({ error: "Could not load payment history." });
      return;
    }

    const { data: payments, error } = await supabaseAdmin
      .from("plisio_payments")
      .select("payment_id, price_amount, price_currency, payment_amount, payment_currency, payment_status, created_at, updated_at, activated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("Could not load a user's subscription payment history.", error);
      response.status(503).json({ error: "Could not load payment history." });
      return;
    }
    response.json({
      payments: (payments ?? []).map((payment) => ({
        paymentId: payment.payment_id,
        priceAmount: Number(payment.price_amount),
        priceCurrency: payment.price_currency,
        payAmount: Number(payment.payment_amount),
        payCurrency: payment.payment_currency,
        status: payment.payment_status,
        createdAt: payment.created_at,
        updatedAt: payment.updated_at,
        activatedAt: payment.activated_at,
      })),
    });
  });

  app.get("/api/subscription/payments/order/:orderId", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!subscriptionsEnabled || !supabaseAdmin) {
      response.status(404).json({ error: "Subscription payments are unavailable." });
      return;
    }
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({ error: "Sign in to check payment status." });
      return;
    }
    const orderId = request.params.orderId;
    if (!/^gs-[a-f\d]{32}$/i.test(orderId)) {
      response.status(400).json({ error: "Invalid payment order." });
      return;
    }
    const [{ data: payment, error: paymentError }, subscription] = await Promise.all([
      supabaseAdmin
        .from("plisio_payments")
        .select("payment_id, order_id, payment_address, qr_code, payment_amount, payment_currency, payment_status, expires_at, activated_at")
        .eq("order_id", orderId)
        .eq("user_id", user.id)
        .maybeSingle(),
      getSubscriptionExpiry(user.id),
    ]);
    if (paymentError || subscription.error) {
      response.status(503).json({ error: "Could not check the payment status." });
      return;
    }
    if (!payment) {
      response.status(404).json({ error: "Payment not found." });
      return;
    }
    let paymentStatus = payment.payment_status;
    if (
      !payment.activated_at &&
      ["new", "pending"].includes(paymentStatus) &&
      payment.expires_at &&
      Date.parse(payment.expires_at) <= Date.now()
    ) {
      const { data: deletedPayments, error: deleteError } = await supabaseAdmin
        .from("plisio_payments")
        .delete()
        .eq("payment_id", payment.payment_id)
        .eq("user_id", user.id)
        .is("activated_at", null)
        .in("payment_status", ["new", "pending"])
        .lte("expires_at", new Date().toISOString())
        .select("payment_id");
      if (deleteError) {
        console.error("Could not remove an expired subscription payment.", deleteError);
        response.status(503).json({ error: "Could not check the payment status." });
        return;
      }
      if (deletedPayments?.length) {
        paymentStatus = "expired";
      } else {
        const { data: latestPayment, error: latestPaymentError } = await supabaseAdmin
          .from("plisio_payments")
          .select("payment_status")
          .eq("order_id", orderId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (latestPaymentError) {
          response.status(503).json({ error: "Could not check the payment status." });
          return;
        }
        paymentStatus = latestPayment?.payment_status ?? "expired";
      }
    }
    response.json({
      paymentId: payment.payment_id,
      orderId: payment.order_id,
      payAddress: payment.payment_address,
      qrCode: payment.qr_code,
      payAmount: Number(payment.payment_amount),
      payCurrency: payment.payment_currency,
      status: paymentStatus,
      expiresAt: payment.expires_at,
      subscriptionExpiresAt: subscription.expiresAt,
    });
  });

  app.get("/api/subscription/payments/:paymentId", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!subscriptionsEnabled || !supabaseAdmin) {
      response.status(404).json({ error: "Subscription payments are unavailable." });
      return;
    }
    const user = await authenticateSupabaseRequest(request);
    if (!user) {
      response.status(supabaseAuth ? 401 : 503).json({ error: "Sign in to check payment status." });
      return;
    }
    const paymentId = request.params.paymentId;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(paymentId)) {
      response.status(400).json({ error: "Invalid payment id." });
      return;
    }
    const [{ data: payment, error: paymentError }, subscription] = await Promise.all([
      supabaseAdmin
        .from("plisio_payments")
        .select("payment_id, order_id, payment_address, qr_code, payment_amount, payment_currency, payment_status")
        .eq("payment_id", paymentId)
        .eq("user_id", user.id)
        .maybeSingle(),
      getSubscriptionExpiry(user.id),
    ]);
    if (paymentError || subscription.error) {
      response.status(503).json({ error: "Could not check the payment status." });
      return;
    }
    if (!payment) {
      response.status(404).json({ error: "Payment not found." });
      return;
    }
    response.json({
      paymentId: payment.payment_id,
      orderId: payment.order_id,
      payAddress: payment.payment_address,
      qrCode: payment.qr_code,
      payAmount: Number(payment.payment_amount),
      payCurrency: payment.payment_currency,
      status: payment.payment_status,
      subscriptionExpiresAt: subscription.expiresAt,
    });
  });

  app.get("/api/deriv/oauth/start", (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!derivAppId || !derivRedirectUri) {
      response.status(503).send("Deriv OAuth is not configured for this app.");
      return;
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(derivRedirectUri);
    } catch {
      response.status(500).send("Deriv OAuth redirect URI is invalid.");
      return;
    }
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if (
      redirectUrl.origin !== requestOrigin ||
      redirectUrl.pathname !== "/api/deriv/oauth/callback" ||
      redirectUrl.search ||
      redirectUrl.hash
    ) {
      response.status(500).send("Set DERIV_REDIRECT_URI to this app's exact Deriv OAuth callback URL.");
      return;
    }
    if (process.env.NODE_ENV === "production" && redirectUrl.protocol !== "https:") {
      response.status(500).send("Deriv OAuth redirect URI must use HTTPS.");
      return;
    }

    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    appendCookie(response, "deriv_oauth_state", state, oauthCookiePath, 600);
    appendCookie(response, "deriv_pkce_verifier", verifier, oauthCookiePath, 600);

    const authorizationUrl = new URL("https://auth.deriv.com/oauth2/auth");
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: derivAppId,
      redirect_uri: derivRedirectUri,
      scope: "trade",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    response.redirect(authorizationUrl.toString());
  });

  app.get("/api/deriv/oauth/callback", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const clearOauthCookies = () => {
      clearCookie(response, "deriv_oauth_state", oauthCookiePath);
      clearCookie(response, "deriv_pkce_verifier", oauthCookiePath);
    };
    const redirectToResult = (result: string) => {
      response.redirect(`/?deriv_oauth=${encodeURIComponent(result)}`);
    };
    const authorizationError = request.query.error;
    if (typeof authorizationError === "string") {
      clearOauthCookies();
      redirectToResult(authorizationError === "access_denied" ? "cancelled" : "authorization_failed");
      return;
    }

    const code = request.query.code;
    const returnedState = request.query.state;
    const expectedState = readCookie(request, "deriv_oauth_state");
    const verifier = readCookie(request, "deriv_pkce_verifier");
    if (
      typeof code !== "string" ||
      typeof returnedState !== "string" ||
      !expectedState ||
      !verifier
    ) {
      clearOauthCookies();
      redirectToResult("callback_invalid");
      return;
    }

    const actualState = Buffer.from(returnedState);
    const storedState = Buffer.from(expectedState);
    if (actualState.length !== storedState.length || !timingSafeEqual(actualState, storedState)) {
      clearOauthCookies();
      redirectToResult("state_mismatch");
      return;
    }

    if (!derivAppId || !derivRedirectUri) {
      clearOauthCookies();
      redirectToResult("oauth_not_configured");
      return;
    }
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(derivRedirectUri);
    } catch {
      clearOauthCookies();
      redirectToResult("oauth_not_configured");
      return;
    }
    const requestOrigin = `${request.protocol}://${request.get("host")}`;
    if (
      redirectUrl.origin !== requestOrigin ||
      redirectUrl.pathname !== "/api/deriv/oauth/callback" ||
      redirectUrl.search ||
      redirectUrl.hash
    ) {
      clearOauthCookies();
      redirectToResult("redirect_mismatch");
      return;
    }

    try {
      const tokenResponse = await fetch("https://auth.deriv.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: derivAppId,
          code,
          redirect_uri: derivRedirectUri,
          code_verifier: verifier,
        }),
      });
      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.json().catch(() => null) as {
          error?: unknown;
          error_description?: unknown;
        } | null;
        console.error("Deriv OAuth token exchange failed", {
          status: tokenResponse.status,
          error: typeof errorBody?.error === "string" ? errorBody.error : undefined,
          description: typeof errorBody?.error_description === "string"
            ? errorBody.error_description.slice(0, 300)
            : undefined,
        });
        clearOauthCookies();
        redirectToResult("token_exchange_failed");
        return;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
      };
      if (
        typeof tokenData.access_token !== "string" ||
        typeof tokenData.expires_in !== "number" ||
        !Number.isFinite(tokenData.expires_in) ||
        tokenData.expires_in <= 0
      ) {
        console.error("Deriv OAuth token exchange returned an invalid token response.");
        clearOauthCookies();
        redirectToResult("token_response_invalid");
        return;
      }

      clearOauthCookies();
      const accessToken = tokenData.access_token;
      const refreshToken = typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : "";
      const expiresInSeconds = typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in)
        ? Math.max(1, Math.floor(tokenData.expires_in))
        : 3600;
      appendCookie(
        response,
        "deriv_access_token",
        Buffer.from(accessToken).toString("base64url"),
        derivCookiePath,
        expiresInSeconds,
      );
      if (refreshToken) {
        appendCookie(
          response,
          "deriv_refresh_token",
          Buffer.from(refreshToken).toString("base64url"),
          derivCookiePath,
          30 * 24 * 60 * 60,
        );
      }
      redirectToResult("connected");
    } catch (error) {
      console.error("Deriv OAuth token exchange could not be completed.", error);
      clearOauthCookies();
      redirectToResult("token_exchange_failed");
    }
  });

  app.get("/api/deriv/session", async (request, response) => {
    response.set("Cache-Control", "no-store");
    let accessToken = readEncodedCookie(request, "deriv_access_token");
    if (!accessToken) {
      const refreshedToken = await refreshDerivAccessToken(request, response);
      accessToken = refreshedToken ?? null;
    }

    if (!accessToken) {
      response.json({ connected: false });
      return;
    }

    try {
      const accountEndpoints = [
        "https://api.deriv.com/api/v3/accounts",
        "https://api.derivws.com/trading/v1/options/accounts",
      ];
      let accounts: Array<{ accountId: string; accountType: string; balance: number; currency: string }> = [];

      for (const endpoint of accountEndpoints) {
        try {
          const accountResponse = await fetch(endpoint, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          });
          if (accountResponse.status === 401) {
            const refreshedToken = await refreshDerivAccessToken(request, response);
            if (refreshedToken) {
              accessToken = refreshedToken;
              continue;
            }
            clearCookie(response, "deriv_access_token", derivCookiePath);
            clearCookie(response, "deriv_refresh_token", derivCookiePath);
            response.json({ connected: false, expired: true });
            return;
          }
          if (!accountResponse.ok) continue;

          const accountPayload = await accountResponse.json().catch(() => null);
          const normalized = normalizeDerivAccounts(accountPayload);
          if (normalized.length > 0) {
            accounts = normalized;
            break;
          }
        } catch (error) {
          console.warn("Deriv account endpoint failed", { endpoint, error });
        }
      }

      if (accounts.length > 0) {
        response.json({ connected: true, accounts });
        return;
      }

      response.json({
        connected: true,
        accounts: [],
        warning: "Deriv authorization succeeded, but account details could not be loaded.",
      });
    } catch (error) {
      console.error("Could not verify the Deriv account connection.", error);
      response.json({
        connected: true,
        accounts: [],
        warning: "Deriv authorization succeeded, but account details could not be loaded.",
      });
    }
  });

  app.get("/api/deriv/balance-stream", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const accountId = request.query.accountId;
    if (typeof accountId !== "string" || !/^[a-zA-Z0-9_-]{2,64}$/.test(accountId)) {
      response.status(400).json({ error: "Invalid Deriv account." });
      return;
    }
    if (!derivAppId) {
      response.status(503).json({ error: "Deriv live balance updates are not configured." });
      return;
    }

    let accessToken = readEncodedCookie(request, "deriv_access_token");
    if (!accessToken) accessToken = await refreshDerivAccessToken(request, response);
    if (!accessToken) {
      response.status(401).json({ error: "Connect your Deriv account to receive balance updates." });
      return;
    }

    response.set({
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write("retry: 3000\n\n");

    let closeSubscription = () => {};
    const keepAlive = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(": keepalive\n\n");
    }, 20_000);
    response.on("close", () => {
      clearInterval(keepAlive);
      closeSubscription();
    });

    closeSubscription = subscribeDerivBalance({
      accessToken,
      appId: derivAppId,
      accountId,
      onBalance: (balance) => {
        if (!response.destroyed && !response.writableEnded) {
          response.write(`data: ${JSON.stringify({ type: "balance", ...balance })}\n\n`);
        }
      },
      onError: (message) => {
        if (!response.destroyed && !response.writableEnded) {
          response.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
          response.end();
        }
      },
    });
  });

  app.post("/api/deriv/session/disconnect", (_request, response) => {
    clearCookie(response, "deriv_access_token", derivCookiePath);
    clearCookie(response, "deriv_refresh_token", derivCookiePath);
    response.set("Cache-Control", "no-store");
    response.json({ connected: false });
  });

  app.post(
    "/api/deriv/bot-trade",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many bot trades. Please wait before trying again." },
    }),
    express.json({ limit: "4kb" }),
    async (request, response) => {
      response.set("Cache-Control", "no-store");
      const requestOrigin = request.get("origin");
      if (!requestOrigin) {
        response.status(403).json({ error: "Trading requests must come from this app." });
        return;
      }
      try {
        if (new URL(requestOrigin).origin !== `${request.protocol}://${request.get("host")}`) {
          response.status(403).json({ error: "Trading requests must come from this app." });
          return;
        }
      } catch {
        response.status(403).json({ error: "Trading request origin is invalid." });
        return;
      }

      const user = await authenticateSupabaseRequest(request);
      if (!user) {
        response.status(supabaseAuth ? 401 : 503).json({
          error: supabaseAuth ? "Sign in before starting the bot." : "Supabase authentication is not configured.",
        });
        return;
      }
      if (subscriptionsEnabled) {
        const subscription = await getSubscriptionExpiry(user.id);
        if (subscription.error) {
          response.status(503).json({ error: subscription.error });
          return;
        }
        if (!subscription.expiresAt || Date.parse(subscription.expiresAt) <= Date.now()) {
          response.status(403).json({
            code: "SUBSCRIPTION_REQUIRED",
            error: "An active 12-hour subscription is required to trade. Renew in Settings.",
          });
          return;
        }
      }

      const body: unknown = request.body;
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as Record<string, unknown>).accountId !== "string" ||
        typeof (body as Record<string, unknown>).contractType !== "string" ||
        typeof (body as Record<string, unknown>).stake !== "number" ||
        typeof (body as Record<string, unknown>).candleEpoch !== "number"
      ) {
        response.status(400).json({ error: "Invalid bot trade request." });
        return;
      }
      const { accountId, contractType, stake, candleEpoch } = body as {
        accountId: string;
        contractType: string;
        stake: number;
        candleEpoch: number;
      };
      if (
        !/^[a-zA-Z0-9_-]{2,64}$/.test(accountId) ||
        (contractType !== "CALL" && contractType !== "PUT") ||
        !Number.isFinite(stake) ||
        stake <= 0 ||
        !Number.isSafeInteger(candleEpoch) ||
        candleEpoch % 60 !== 0
      ) {
        response.status(400).json({ error: "Invalid account, direction, or stake." });
        return;
      }

      let marketCandles;
      try {
        marketCandles = await fetchRecentDerivCandles("R_100");
      } catch (error) {
        console.error("Could not validate a bot trade against Deriv market data.", error);
        response.status(503).json({ error: "Could not verify the trading opportunity. Please wait for the next signal." });
        return;
      }
      const currentMinuteStart = Math.floor(Date.now() / 60_000) * 60;
      const closedCandles = marketCandles.filter(
        (candle) => candle.epoch + 60 <= currentMinuteStart,
      );
      const latestClosedEpoch = closedCandles[closedCandles.length - 1]?.epoch;
      if (
        latestClosedEpoch === undefined ||
        candleEpoch > latestClosedEpoch ||
        latestClosedEpoch - candleEpoch > 120
      ) {
        response.status(409).json({
          code: "STRATEGY_SIGNAL_STALE",
          error: "That trading opportunity has expired. Waiting for the next confirmed setup.",
        });
        return;
      }
      const signalIndex = closedCandles.findIndex((candle) => candle.epoch === candleEpoch);
      const validatedSignal = signalIndex >= 0
        ? evaluateDerivStrategy(
            closedCandles.slice(0, signalIndex + 1),
            DEFAULT_STRATEGY_CONFIG,
          )
        : null;
      if (
        !validatedSignal ||
        validatedSignal.candleEpoch !== candleEpoch ||
        validatedSignal.contractType !== contractType
      ) {
        response.status(409).json({
          code: "STRATEGY_SIGNAL_INVALID",
          error: "The trading opportunity could not be confirmed. Waiting for the next setup.",
        });
        return;
      }

      let accessToken = readEncodedCookie(request, "deriv_access_token");
      if (!accessToken) {
        accessToken = await refreshDerivAccessToken(request, response);
      }
      if (!accessToken) {
        response.status(401).json({ error: "Connect your Deriv account before trading." });
        return;
      }

      const otpPromise = getDerivTradingOtpUrl({ accessToken, accountId }).then(
        (otpUrl) => ({ otpUrl }),
        (error: unknown) => ({ error }),
      );
      let accounts: NormalizedDerivAccount[] = [];
      let accountLookupSucceeded = false;
      let lastAccountLookupStatus: number | null = null;
      let accountLookupFailed = false;
      for (const endpoint of [
        "https://api.deriv.com/api/v3/accounts",
        "https://api.derivws.com/trading/v1/options/accounts",
      ]) {
        try {
          const accountResponse = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          lastAccountLookupStatus = accountResponse.status;
          if (!accountResponse.ok) continue;
          const payload: unknown = await accountResponse.json();
          accountLookupSucceeded = true;
          accounts = normalizeDerivAccounts(payload);
          if (accounts.length > 0) break;
        } catch {
          accountLookupFailed = true;
        }
      }

      if (!accountLookupSucceeded && accountLookupFailed) {
        console.error("Could not verify the selected Deriv account before trading.");
        response.status(503).json({ error: "Could not verify Deriv accounts. Please try again." });
        return;
      }
      if (!accountLookupSucceeded) {
        response.status(lastAccountLookupStatus === 401 ? 401 : 503).json({
          error: lastAccountLookupStatus === 401
            ? "Deriv authorization expired. Reconnect your account."
            : "Could not verify Deriv accounts. Please try again.",
        });
        return;
      }
      const account = accounts.find((candidate) => candidate.accountId === accountId);
      if (!account) {
        response.status(403).json({ error: "That Deriv account is not authorized for this session." });
        return;
      }
      if (stake > account.balance) {
        response.status(400).json({
          code: "INSUFFICIENT_BALANCE",
          error: "The selected Deriv account does not have enough balance for this trade.",
        });
        return;
      }

      const tradeKey = `${account.accountType}:${account.accountId}`;
      if (activeDerivTrades.has(tradeKey) || activeDerivUsers.has(user.id)) {
        response.status(409).json({ error: "A contract is already being processed for this account." });
        return;
      }
      if (!claimDerivSignal(`${user.id}:${tradeKey}:${candleEpoch}`)) {
        response.status(409).json({
          code: "STRATEGY_SIGNAL_DUPLICATE",
          error: "This trading opportunity has already been processed.",
        });
        return;
      }
      activeDerivTrades.add(tradeKey);
      activeDerivUsers.add(user.id);
      let streamStarted = false;
      try {
        const otpResult = await otpPromise;
        if ("error" in otpResult) throw otpResult.error;
        const trade = await executeDerivOneMinuteTrade({
          accessToken,
          accountId,
          accountType: account.accountType,
          otpUrl: otpResult.otpUrl,
          contractType,
          currency: account.currency,
          stake,
          onPurchased: (purchase) => {
            if (response.destroyed || response.writableEnded) return;
            if (!streamStarted) {
              response.set({
                "Cache-Control": "no-store, no-transform",
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "X-Content-Type-Options": "nosniff",
              });
              response.flushHeaders();
              streamStarted = true;
            }
            response.write(`${JSON.stringify({ type: "purchased", ...purchase, currency: account.currency, contractType })}\n`);
          },
          onProgress: (progress) => {
            if (response.destroyed || response.writableEnded || !streamStarted) return;
            response.write(`${JSON.stringify({ type: "progress", ...progress })}\n`);
          },
        });
        if (streamStarted) {
          if (!response.destroyed && !response.writableEnded) {
            response.write(`${JSON.stringify({ type: "settled", ...trade })}\n`);
            response.end();
          }
        } else if (!response.destroyed && !response.writableEnded) {
          response.json(trade);
        }
      } catch (error) {
        if (streamStarted) {
          const errorMessage = error instanceof DerivTradeError
            ? error.message
            : "Could not complete the Deriv bot trade.";
          if (!(error instanceof DerivTradeError)) {
            console.error("Could not complete the Deriv bot trade.");
          }
          if (!response.destroyed && !response.writableEnded) {
            response.write(`${JSON.stringify({
              type: "error",
              error: errorMessage,
              ...(error instanceof DerivTradeError && error.code ? { code: error.code } : {}),
              tradeMayBeOpen: error instanceof DerivTradeError && error.tradeMayBeOpen,
            })}\n`);
            response.end();
          }
        } else if (error instanceof DerivTradeError && !response.destroyed && !response.writableEnded) {
          response.status(error.tradeMayBeOpen ? 504 : 502).json({
            error: error.message,
            ...(error.code ? { code: error.code } : {}),
            tradeMayBeOpen: error.tradeMayBeOpen,
          });
        } else if (!response.destroyed && !response.writableEnded) {
          console.error("Could not complete the Deriv bot trade.");
          response.status(502).json({ error: "Could not complete the Deriv bot trade." });
        }
      } finally {
        activeDerivTrades.delete(tradeKey);
        activeDerivUsers.delete(user.id);
      }
    },
  );

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    socket.emit("sync:ready", { connected: true, serverTime: Date.now() });

    socket.on("sync:ping", (clientTime: number) => {
      if (typeof clientTime !== "number" || !Number.isFinite(clientTime)) return;
      socket.emit("sync:pong", { clientTime, serverTime: Date.now() });
    });
  });

  app.use((request, response) => nextHandler(request, response));

  server.listen(port, "0.0.0.0", () => {
    console.log(`G-Sync is ready on http://localhost:${port}`);
  });

  if (subscriptionsEnabled && supabaseAdmin) {
    const cleanupExpiredPayments = async () => {
      try {
        const { error } = await deleteExpiredPlisioPayments();
        if (error) console.error("Could not remove expired subscription payments.", error);
      } catch (error) {
        console.error("Could not remove expired subscription payments.", error);
      }
    };
    void cleanupExpiredPayments();
    setInterval(() => void cleanupExpiredPayments(), 10_000);
  }
}

startServer();