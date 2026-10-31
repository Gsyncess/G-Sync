import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import next from "next";
import { createClient } from "@supabase/supabase-js";
import { Server as SocketServer } from "socket.io";

const development = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const derivAppId = (process.env.DERIV_APP_ID ?? process.env.NEXT_PUBLIC_DERIV_APP_ID)?.trim();
const derivRedirectUri = process.env.DERIV_REDIRECT_URI?.trim();
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
      appendCookie(
        response,
        "deriv_access_token",
        Buffer.from(tokenData.access_token).toString("base64url"),
        derivCookiePath,
        Math.floor(tokenData.expires_in),
      );
      redirectToResult("connected");
    } catch (error) {
      console.error("Deriv OAuth token exchange could not be completed.", error);
      clearOauthCookies();
      redirectToResult("token_exchange_failed");
    }
  });

  app.get("/api/deriv/session", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const accessToken = readEncodedCookie(request, "deriv_access_token");
    if (!accessToken) {
      response.json({ connected: false });
      return;
    }

    try {
      const accountResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (accountResponse.status === 401) {
        clearCookie(response, "deriv_access_token", derivCookiePath);
        response.json({ connected: false, expired: true });
        return;
      }
      if (!accountResponse.ok) {
        console.error("Deriv account verification failed", { status: accountResponse.status });
        response.json({
          connected: true,
          accounts: [],
          warning: "Deriv authorization succeeded, but account details could not be loaded.",
        });
        return;
      }

      const accountData = (await accountResponse.json()) as {
        data?: Array<{ account_type?: unknown; currency?: unknown }>;
      };
      const accounts = (accountData.data ?? []).map((account) => ({
        accountType: typeof account.account_type === "string" ? account.account_type : "unknown",
        currency: typeof account.currency === "string" ? account.currency : "",
      }));
      response.json({ connected: true, accounts });
    } catch (error) {
      console.error("Could not verify the Deriv account connection.", error);
      response.json({
        connected: true,
        accounts: [],
        warning: "Deriv authorization succeeded, but account details could not be loaded.",
      });
    }
  });

  app.post("/api/deriv/session/disconnect", (_request, response) => {
    clearCookie(response, "deriv_access_token", derivCookiePath);
    response.set("Cache-Control", "no-store");
    response.json({ connected: false });
  });

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
}

startServer();