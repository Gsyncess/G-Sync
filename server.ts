import { createServer } from "node:http";
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
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
};

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