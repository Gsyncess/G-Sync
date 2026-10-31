"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { DashboardHome } from "@/components/dashboard-home";
import { RobotLogo } from "@/components/robot-logo";

type Screen = "splash" | "login" | "signup" | "reset";

export function MobileAuth() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [socketOnline, setSocketOnline] = useState(false);
  const [realtimeLatency, setRealtimeLatency] = useState<number | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [splashComplete, setSplashComplete] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSplashComplete(true);
      setScreen("login");
    }, 8000);
    const socket = io({
      autoConnect: false,
      reconnectionAttempts: 8,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socket.on("sync:ready", () => {
      setSocketOnline(true);
      socket.emit("sync:ping", Date.now());
    });
    socket.on("sync:pong", ({ clientTime }: { clientTime: number }) => {
      if (Number.isFinite(clientTime)) setRealtimeLatency(Date.now() - clientTime);
    });
    socket.on("connect_error", () => setSocketOnline(false));
    socket.on("disconnect", () => {
      setSocketOnline(false);
      setRealtimeLatency(null);
    });

    let unsubscribeFromAuth = () => {};
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session?.access_token) {
          setAuthenticated(false);
          setAccountEmail("");
          socket.disconnect();
          return;
        }

        setAuthenticated(true);
        setAccountEmail(session.user.email ?? "");
        socket.auth = { accessToken: session.access_token };
        if (socket.connected) socket.disconnect();
        socket.connect();
      });
      unsubscribeFromAuth = () => data.subscription.unsubscribe();

      void supabase.auth.getSession().then(({ data: sessionData, error }) => {
        if (error || !sessionData.session) return;
        setAuthenticated(true);
        setAccountEmail(sessionData.session.user.email ?? "");
        socket.auth = { accessToken: sessionData.session.access_token };
        socket.connect();
      });
    }

    return () => {
      window.clearTimeout(timer);
      unsubscribeFromAuth();
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  const changeScreen = (nextScreen: Screen) => {
    setMessage("");
    setPassword("");
    setConfirmPassword("");
    setScreen(nextScreen);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!supabase) {
      setMessage("Connect your Supabase project to start using G-Sync.");
      return;
    }

    setBusy(true);
    try {
      if (screen === "signup") {
        if (password !== confirmPassword) {
          setMessage("Those passwords do not match yet.");
          return;
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Check your inbox for a link to verify your email.");
      } else if (screen === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMessage("Password reset link sent. Check your inbox.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMessage("You’re signed in. Your G-Sync is ready.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const isSplash = screen === "splash";
  const title = screen === "signup" ? "Create your account" : screen === "reset" ? "Reset your password" : "Login to your account";
  const action = screen === "signup" ? "Sign up" : screen === "reset" ? "Send reset link" : "Sign in";
  const shellBackground = "#ffffff";

  useEffect(() => {
    const themeMetaTags = document.querySelectorAll('meta[name="theme-color"]');
    if (themeMetaTags.length === 0) {
      const themeMeta = document.createElement("meta");
      themeMeta.setAttribute("name", "theme-color");
      themeMeta.setAttribute("content", shellBackground);
      document.head.appendChild(themeMeta);
    } else {
      themeMetaTags.forEach((themeMeta) => themeMeta.setAttribute("content", shellBackground));
    }
    document.documentElement.style.setProperty("--phone-bg", shellBackground);
    document.documentElement.style.backgroundColor = shellBackground;
    document.body.style.backgroundColor = shellBackground;
    document.body.style.color = "#17213a";
  }, [shellBackground, isSplash]);

  if (authenticated && splashComplete) {
    return (
      <DashboardHome
        email={accountEmail}
        socketOnline={socketOnline}
        onSignOut={() => {
          void supabase?.auth.signOut();
        }}
      />
    );
  }

  return (
    <main
      className="phone-shell relative flex min-h-svh flex-col px-7 pb-8 pt-4 sm:px-8"
      style={{ background: shellBackground }}
    >
      <AnimatePresence mode="wait">
        {isSplash ? (
          <motion.section
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white text-slate-900"
            aria-label="G-Sync splash screen"
          >
            <motion.div
              animate={{ y: [0, -6, 0], rotate: [0, 4, -4, 0] }}
              transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
              className="mb-5 grid size-[92px] place-items-center rounded-[28px] border border-emerald-100 bg-emerald-50/80 shadow-[0_16px_38px_rgba(15,23,42,0.12)]"
            >
              <RobotLogo className="size-[68px]" />
            </motion.div>
            <span className="text-[32px] font-semibold tracking-tight">G-Sync</span>
            <span className="mt-2 text-sm text-slate-500">Your life, in sync.</span>
            <div className="absolute bottom-10 flex items-center gap-2 text-[11px] text-slate-400">
              <Sparkles size={13} /> A little more in sync
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="auth"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-[calc(100svh-48px)] flex-1 flex-col"
          >
            <header className="relative flex h-12 items-center justify-center">
              {screen !== "login" && (
                <button
                  type="button"
                  onClick={() => changeScreen("login")}
                  className="absolute left-0 grid size-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100"
                  aria-label="Back to sign in"
                >
                  <ArrowLeft size={19} />
                </button>
              )}
              <a href="#home" className="flex items-center gap-2 text-[21px] font-bold tracking-tight text-brand-700" aria-label="G-Sync home">
                <span className="grid size-9 place-items-center rounded-xl bg-emerald-50">
                  <RobotLogo className="size-8" />
                </span>
                <span>
                  G-Sync<span className="text-brand-500">.</span>
                </span>
              </a>
            </header>

            <div className="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              {screen === "reset" ? <LockKeyhole size={23} /> : <RobotLogo className="size-12" />}
            </div>

            <section className="mt-6 flex flex-1 flex-col" aria-labelledby="auth-title">
              <div className="mb-6">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-500">Welcome to G-Sync</p>
                <h1 id="auth-title" className="text-[23px] font-semibold leading-tight tracking-tight text-slate-900">
                  {title}
                </h1>
                <p className="mt-2 text-sm leading-5 text-slate-500">
                  {screen === "signup"
                    ? "Create an account and bring everything together."
                    : screen === "reset"
                      ? "We’ll send a reset link to your email."
                      : "Everything in its place. One less thing to think about."}
                </p>
              </div>

              <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                <label className="relative block">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                  <Input
                    aria-label="Email"
                    autoComplete="email"
                    type="email"
                    placeholder="Email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="pl-11"
                  />
                </label>

                {screen !== "reset" && (
                  <>
                    <label className="relative block">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                      <Input
                        aria-label="Password"
                        autoComplete={screen === "signup" ? "new-password" : "current-password"}
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        minLength={6}
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="px-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:text-slate-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </label>
                    {screen === "signup" && (
                      <label className="relative block">
                        <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                        <Input
                          aria-label="Confirm password"
                          autoComplete="new-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Confirm password"
                          minLength={6}
                          required
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          className="pl-11"
                        />
                      </label>
                    )}
                  </>
                )}

                {screen === "login" && (
                  <button
                    type="button"
                    onClick={() => changeScreen("reset")}
                    className="-mt-1 self-end py-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Forgot password?
                  </button>
                )}

                <Button type="submit" disabled={busy} className="mt-1 w-full">
                  {busy ? "Please wait..." : action}
                  {!busy && <ArrowRight size={17} />}
                </Button>
              </form>

              <AnimatePresence>
                {message && (
                  <motion.p
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    role="status"
                    className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-xs leading-5 text-brand-700"
                  >
                    {message}
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="mt-auto pt-8 text-center">
                <div className="mb-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck size={14} className="text-brand-500" /> Your information stays yours
                </div>
                <p className="text-xs text-slate-500">
                  {screen === "signup" ? "Already have an account?" : "Don’t have an account?"}{" "}
                  <button
                    type="button"
                    onClick={() => changeScreen(screen === "signup" ? "login" : "signup")}
                    className="font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {screen === "signup" ? "Sign in" : "Sign up"}
                  </button>
                </p>
                <p className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                  <span className={`size-1.5 rounded-full ${socketOnline ? "bg-emerald-500" : "bg-slate-300"}`} />
                  {socketOnline
                    ? realtimeLatency === null
                      ? "Realtime connected"
                      : `Realtime connected · ${realtimeLatency} ms`
                    : supabase
                      ? "Realtime waiting for sign in"
                      : "Connect Supabase to enable sync"}
                  {message.includes("Check your inbox") && <Check size={12} />}
                </p>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}