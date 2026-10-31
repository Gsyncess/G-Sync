"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Clock3,
  Home,
  LogOut,
  Settings2,
  X,
} from "lucide-react";
import { MarketConsole, type MarketSignal } from "@/components/market-console";
import { SignalPage, type SignalConfig } from "@/components/signal-page";
import { RobotLogo } from "@/components/robot-logo";
import {
  SettingsPage,
  type AppSubscription,
  type SubscriptionPayment,
  type SubscriptionPaymentRecord,
} from "@/components/settings-page";
import { supabase } from "@/lib/supabase";

type DerivAccount = {
  accountId: string;
  accountType: string;
  balance: number;
  currency: string;
};

type DerivSessionResponse = {
  connected?: boolean;
  expired?: boolean;
  accounts?: DerivAccount[];
  warning?: string;
  error?: string;
};

type SessionPerformance = {
  profit: number;
  wins: number;
  losses: number;
  trades: number;
};

type OpenTradeDetails = {
  stake: number;
  payout: number;
  currency: string;
  contractType: "CALL" | "PUT";
};

type TradeHistoryEntry = {
  id: string;
  contractId: number;
  contractType: "CALL" | "PUT";
  stake: number;
  payout: number;
  currency: string;
  profit: number;
  completedAt: string;
};

type TradeErrorToast = {
  id: number;
  message: string;
};

type BotRuntime = {
  running: boolean;
  inFlight: boolean;
  unresolvedTrade: boolean;
  sessionLimitReached: boolean;
  nextStake: number | null;
  sessionProfit: number;
};

type DashboardHomeProps = {
  email: string;
  accountId: string;
  username: string;
  socketOnline: boolean;
  onSignOut: () => void;
};

async function getSupabaseAccessToken() {
  if (!supabase) throw new Error("Supabase authentication is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Sign in again to continue.");
  return data.session.access_token;
}

function isTradeHistoryEntry(value: unknown): value is TradeHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.contractId === "number" &&
    Number.isFinite(entry.contractId) &&
    (entry.contractType === "CALL" || entry.contractType === "PUT") &&
    typeof entry.stake === "number" &&
    Number.isFinite(entry.stake) &&
    typeof entry.payout === "number" &&
    Number.isFinite(entry.payout) &&
    typeof entry.currency === "string" &&
    entry.currency.length > 0 &&
    typeof entry.profit === "number" &&
    Number.isFinite(entry.profit) &&
    typeof entry.completedAt === "string" &&
    !Number.isNaN(Date.parse(entry.completedAt))
  );
}

export function DashboardHome({ email, accountId, username, socketOnline, onSignOut }: DashboardHomeProps) {
  const [derivAccounts, setDerivAccounts] = useState<DerivAccount[]>([]);
  const [derivConnected, setDerivConnected] = useState(false);
  const [derivBusy, setDerivBusy] = useState(true);
  const [derivMessage, setDerivMessage] = useState("");
  const [balanceRefreshError, setBalanceRefreshError] = useState("");
  const [selectedDerivAccountId, setSelectedDerivAccountId] = useState("");
  const [derivMenuOpen, setDerivMenuOpen] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const [tradeProgressTicks, setTradeProgressTicks] = useState(0);
  const [openTradeDetails, setOpenTradeDetails] = useState<OpenTradeDetails | null>(null);
  const [botStatus, setBotStatus] = useState("Ready");
  const [tradeErrorToast, setTradeErrorToast] = useState<TradeErrorToast | null>(null);
  const [marketFeedStatus, setMarketFeedStatus] = useState<"Connecting" | "Live" | "Reconnecting" | "Unavailable">("Connecting");
  const [activeView, setActiveView] = useState<"home" | "signals" | "history" | "settings">("home");
  const [subscription, setSubscription] = useState<AppSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [subscriptionPayment, setSubscriptionPayment] = useState<SubscriptionPayment | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<SubscriptionPaymentRecord[]>([]);
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(true);
  const [paymentHistoryError, setPaymentHistoryError] = useState("");
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyAccountId, setHistoryAccountId] = useState("");
  const [performance, setPerformance] = useState<SessionPerformance>({
    profit: 0,
    wins: 0,
    losses: 0,
    trades: 0,
  });
  const [botConfig, setBotConfig] = useState<SignalConfig>({
    targetProfit: 20,
    targetLoss: 10,
    stakeAmount: 5,
  });
  const selectedDerivAccount = derivAccounts.find(
    (account) => account.accountId === selectedDerivAccountId,
  );
  const accountTrades = historyAccountId === selectedDerivAccountId ? tradeHistory : [];
  const derivMenuRef = useRef<HTMLDivElement>(null);
  const botConfigRef = useRef(botConfig);
  botConfigRef.current = botConfig;
  const selectedAccountRef = useRef<DerivAccount | undefined>(undefined);
  selectedAccountRef.current = selectedDerivAccount;
  const derivConnectedRef = useRef(derivConnected);
  derivConnectedRef.current = derivConnected;
  const marketFeedStatusRef = useRef(marketFeedStatus);
  marketFeedStatusRef.current = marketFeedStatus;
  const tradeToastTimerRef = useRef<number | null>(null);
  const tradeToastIdRef = useRef(0);
  const balanceRefreshRef = useRef(false);
  const subscriptionRefreshRef = useRef(false);
  const botRuntimeRef = useRef<BotRuntime>({
    running: false,
    inFlight: false,
    unresolvedTrade: false,
    sessionLimitReached: false,
    nextStake: null,
    sessionProfit: 0,
  });

  const loadDerivSession = useCallback(async () => {
    setDerivBusy(true);
    try {
      const response = await fetch("/api/deriv/session", { cache: "no-store" });
      const result = (await response.json()) as DerivSessionResponse;
      if (result.connected === true) setDerivConnected(true);
      if (!response.ok) throw new Error(result.error ?? "Could not check the Deriv connection.");
      setDerivConnected(result.connected === true);
      const accounts = result.accounts ?? [];
      setDerivAccounts(accounts);
      const saved = window.localStorage.getItem("deriv-account-id");
      const nextId = accounts.some((account) => account.accountId === saved)
        ? saved!
        : accounts.find((account) => account.accountType === "demo")?.accountId
          ?? accounts[0]?.accountId
          ?? "";
      setSelectedDerivAccountId(nextId);
      if (nextId) window.localStorage.setItem("deriv-account-id", nextId);
      else window.localStorage.removeItem("deriv-account-id");
      if (result.warning) setDerivMessage(result.warning);
      if (result.expired) setDerivMessage("Your Deriv authorization expired. Please connect again.");
    } catch (error) {
      setDerivMessage(error instanceof Error ? error.message : "Could not check the Deriv connection.");
    } finally {
      setDerivBusy(false);
    }
  }, []);

  const refreshPaymentHistory = useCallback(async (accessToken?: string) => {
    try {
      const token = accessToken ?? await getSupabaseAccessToken();
      const response = await fetch("/api/subscription/payments", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json() as {
        payments?: SubscriptionPaymentRecord[];
        error?: unknown;
      };
      if (!response.ok || !Array.isArray(result.payments)) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not load payment history.");
      }
      setPaymentHistory(result.payments);
      setPaymentHistoryError("");
    } catch (error) {
      setPaymentHistoryError(error instanceof Error ? error.message : "Could not load payment history.");
    } finally {
      setPaymentHistoryLoading(false);
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (subscriptionRefreshRef.current) return;
    subscriptionRefreshRef.current = true;
    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/account", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json() as {
        subscription?: AppSubscription;
        error?: unknown;
      };
      if (!response.ok || !result.subscription) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not load subscription status.");
      }
      setSubscription(result.subscription);
      setSubscriptionError("");
      if (result.subscription.enabled) {
        void refreshPaymentHistory(accessToken);
      } else {
        setPaymentHistory([]);
        setPaymentHistoryError("");
        setPaymentHistoryLoading(false);
      }
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : "Could not load subscription status.");
    } finally {
      setSubscriptionLoading(false);
      subscriptionRefreshRef.current = false;
    }
  }, [refreshPaymentHistory]);

  useEffect(() => {
    void refreshSubscription();
    const intervalId = window.setInterval(() => void refreshSubscription(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [refreshSubscription]);

  useEffect(() => {
    const paymentId = subscriptionPayment?.paymentId;
    if (!paymentId || ["finished", "failed", "refunded", "expired"].includes(subscriptionPayment.status)) return;
    let active = true;
    const refreshPayment = async () => {
      try {
        const accessToken = await getSupabaseAccessToken();
        const response = await fetch(`/api/subscription/payments/${encodeURIComponent(paymentId)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json() as {
          status?: unknown;
          expiresAt?: unknown;
          subscriptionExpiresAt?: unknown;
          error?: unknown;
        };
        if (!response.ok || typeof result.status !== "string") {
          throw new Error(typeof result.error === "string" ? result.error : "Could not check payment status.");
        }
        if (!active) return;
        setSubscriptionPayment((current) => current?.paymentId === paymentId
          ? {
              ...current,
              status: result.status as string,
              expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : current.expiresAt,
            }
          : current);
        if (typeof result.subscriptionExpiresAt === "string") {
          setSubscription({
            enabled: true,
            active: Date.parse(result.subscriptionExpiresAt) > Date.now(),
            expiresAt: result.subscriptionExpiresAt,
          });
        }
        if (result.status === "finished") void refreshPaymentHistory();
        setSubscriptionError("");
      } catch (error) {
        if (active) {
          setSubscriptionError(error instanceof Error ? error.message : "Could not check payment status.");
        }
      }
    };
    void refreshPayment();
    const intervalId = window.setInterval(() => void refreshPayment(), 5_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [refreshPaymentHistory, subscriptionPayment?.paymentId, subscriptionPayment?.status]);

  const handleSubscribe = async () => {
    setPaymentBusy(true);
    setSubscriptionError("");
    try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/subscription/payments", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json() as SubscriptionPayment & { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof result.error === "string" ? result.error : "Could not prepare payment.");
      }
      if (!result.paymentId || !result.payAddress || !Number.isFinite(result.payAmount)) {
        throw new Error("Payment instructions were incomplete. Please try again.");
      }
      setSubscriptionPayment(result);
    } catch (error) {
      setSubscriptionError(error instanceof Error ? error.message : "Could not prepare payment.");
    } finally {
      setPaymentBusy(false);
    }
  };

  const refreshDerivAccounts = useCallback(async () => {
    if (balanceRefreshRef.current || botRuntimeRef.current.inFlight) return;
    balanceRefreshRef.current = true;
    try {
      const response = await fetch("/api/deriv/session", { cache: "no-store" });
      const result = await response.json() as DerivSessionResponse;
      if (!response.ok) throw new Error(result.error ?? "Could not refresh Deriv account balances.");
      if (!result.connected) {
        botRuntimeRef.current.running = false;
        botRuntimeRef.current.sessionLimitReached = false;
        botRuntimeRef.current.sessionProfit = 0;
        botRuntimeRef.current.nextStake = null;
        setBotRunning(false);
        setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
        setDerivConnected(false);
        setDerivAccounts([]);
        setSelectedDerivAccountId("");
        window.localStorage.removeItem("deriv-account-id");
        setDerivMessage(
          result.expired
            ? "Your Deriv authorization expired. Please connect again."
            : "Your Deriv account is disconnected.",
        );
        return;
      }

      const accounts = result.accounts ?? [];
      if (accounts.length === 0) {
        if (result.warning) setDerivMessage(result.warning);
        return;
      }

      setDerivConnected(true);
      setDerivAccounts(accounts);
      setBalanceRefreshError("");
      if (!accounts.some((account) => account.accountId === selectedDerivAccountId)) {
        const nextId = accounts.find((account) => account.accountType === "demo")?.accountId
          ?? accounts[0].accountId;
        botRuntimeRef.current.running = false;
        botRuntimeRef.current.sessionLimitReached = false;
        botRuntimeRef.current.sessionProfit = 0;
        botRuntimeRef.current.nextStake = null;
        setBotRunning(false);
        setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
        setSelectedDerivAccountId(nextId);
        window.localStorage.setItem("deriv-account-id", nextId);
      }
    } catch (error) {
      console.warn("Could not refresh Deriv account balances.", error);
      setBalanceRefreshError(error instanceof Error ? error.message : "Balance refresh failed.");
      setDerivMessage(
        error instanceof Error
          ? `${error.message} Retrying automatically.`
          : "Could not refresh Deriv account balances. Retrying automatically.",
      );
    } finally {
      balanceRefreshRef.current = false;
    }
  }, [selectedDerivAccountId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthResult = url.searchParams.get("deriv_oauth");
    if (oauthResult) {
      setDerivMessage(
        oauthResult === "connected"
          ? "Your Deriv account is connected."
          : oauthResult === "cancelled"
            ? "Deriv authorization was cancelled."
            : oauthResult === "state_mismatch"
              ? "Deriv authorization could not be verified. Start Connect again and finish in the same browser."
              : oauthResult === "redirect_mismatch"
                ? "The callback URL does not match the one configured with Deriv. Check DERIV_REDIRECT_URI."
                : oauthResult === "oauth_not_configured"
                  ? "Deriv OAuth is not configured on the server."
                  : oauthResult === "token_exchange_failed"
                    ? "Deriv approved the login, but token exchange failed. Check the Heroku logs and app ID."
                    : oauthResult === "callback_invalid"
                      ? "Deriv returned an incomplete authorization response. Please connect again."
                      : oauthResult === "token_response_invalid"
                        ? "Deriv returned an invalid token response. Please try again."
                        : "Deriv authorization failed. Please try again.",
      );
      url.searchParams.delete("deriv_oauth");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void loadDerivSession();
  }, [loadDerivSession]);

  useEffect(() => {
    if (!derivConnected || !selectedDerivAccountId) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshDerivAccounts();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [derivConnected, refreshDerivAccounts, selectedDerivAccountId]);

  useEffect(() => {
    if (!derivConnected || !selectedDerivAccountId) return;
    const source = new EventSource(
      `/api/deriv/balance-stream?accountId=${encodeURIComponent(selectedDerivAccountId)}`,
    );
    source.onmessage = (event) => {
      let update: unknown;
      try {
        update = JSON.parse(event.data);
      } catch (error) {
        console.warn("Could not read a Deriv balance update.", error);
        setBalanceRefreshError("Deriv sent an unreadable balance update.");
        return;
      }
      if (!update || typeof update !== "object") return;
      const message = update as Record<string, unknown>;
      if (message.type === "error") {
        setBalanceRefreshError(
          typeof message.error === "string" ? message.error : "Live balance updates are unavailable.",
        );
        source.close();
        return;
      }
      const accountId = message.accountId;
      const balance = message.balance;
      const currency = message.currency;
      if (
        message.type !== "balance" ||
        accountId !== selectedDerivAccountId ||
        typeof balance !== "number" ||
        !Number.isFinite(balance) ||
        typeof currency !== "string"
      ) return;

      setDerivAccounts((current) => current.map((account) => (
        account.accountId === accountId
          ? { ...account, balance, currency }
          : account
      )));
      setBalanceRefreshError("");
    };
    source.onerror = () => {
      setBalanceRefreshError("Live balance updates disconnected. Checking balances periodically.");
    };
    return () => source.close();
  }, [derivConnected, selectedDerivAccountId]);

  useEffect(() => {
    setHistoryReady(false);
    if (!selectedDerivAccountId) {
      setTradeHistory([]);
      setHistoryAccountId("");
      setHistoryReady(true);
      return;
    }

    try {
      const saved = window.localStorage.getItem(`deriv-bot-history:${selectedDerivAccountId}`);
      if (!saved) {
        setTradeHistory([]);
      } else {
        const parsed: unknown = JSON.parse(saved);
        setTradeHistory(Array.isArray(parsed) ? parsed.filter(isTradeHistoryEntry).slice(0, 100) : []);
      }
      setHistoryAccountId(selectedDerivAccountId);
    } catch (error) {
      console.warn("Could not load saved Deriv bot history.", error);
      setTradeHistory([]);
      setHistoryAccountId(selectedDerivAccountId);
      setDerivMessage("Saved trade history could not be loaded.");
    } finally {
      setHistoryReady(true);
    }
  }, [selectedDerivAccountId]);

  useEffect(() => {
    if (!historyReady || !selectedDerivAccountId || historyAccountId !== selectedDerivAccountId) return;
    try {
      window.localStorage.setItem(
        `deriv-bot-history:${selectedDerivAccountId}`,
        JSON.stringify(tradeHistory),
      );
    } catch (error) {
      console.warn("Could not save Deriv bot history.", error);
      setDerivMessage("Trade history could not be saved on this device.");
    }
  }, [historyAccountId, historyReady, selectedDerivAccountId, tradeHistory]);

  useEffect(() => {
    if (!derivMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !derivMenuRef.current?.contains(event.target)) {
        setDerivMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDerivMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [derivMenuOpen]);

  useEffect(() => () => {
    if (tradeToastTimerRef.current !== null) {
      window.clearTimeout(tradeToastTimerRef.current);
    }
  }, []);

  const notifyTradeError = useCallback((message: string) => {
    if (tradeToastTimerRef.current !== null) {
      window.clearTimeout(tradeToastTimerRef.current);
    }
    const id = ++tradeToastIdRef.current;
    setTradeErrorToast({ id, message });
    tradeToastTimerRef.current = window.setTimeout(() => {
      setTradeErrorToast((current) => current?.id === id ? null : current);
      tradeToastTimerRef.current = null;
    }, 8000);
  }, []);

  const handleFeedStatus = useCallback((status: typeof marketFeedStatus) => {
    setMarketFeedStatus(status);
  }, []);

  const handleMarketSignal = useCallback((signal: MarketSignal) => {
    const runtime = botRuntimeRef.current;
    if (
      !signal.ready ||
      !runtime.running ||
      runtime.inFlight ||
      marketFeedStatusRef.current !== "Live" ||
      !signal.crossover
    ) return;

    const config = botConfigRef.current;
    if (runtime.sessionProfit >= config.targetProfit || runtime.sessionProfit <= -config.targetLoss) {
      runtime.running = false;
      runtime.sessionLimitReached = true;
      setBotRunning(false);
      setBotStatus(runtime.sessionProfit >= config.targetProfit ? "Session profit target reached" : "Session loss limit reached");
      return;
    }

    const account = selectedAccountRef.current;
    if (!derivConnectedRef.current || !account) {
      runtime.running = false;
      setBotRunning(false);
      setBotStatus("Deriv account unavailable. Bot stopped.");
      return;
    }

    const contractType = signal.crossover;
    const stake = runtime.nextStake ?? config.stakeAmount;

    runtime.inFlight = true;
    setTradeInProgress(true);
    setTradeProgressTicks(0);
    setOpenTradeDetails(null);
    setBotStatus(`${contractType === "CALL" ? "BUY" : "SELL"} · trade in progress`);
    void (async () => {
      try {
      const accessToken = await getSupabaseAccessToken();
      const response = await fetch("/api/deriv/bot-trade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          accountId: account.accountId,
          contractType,
            stake,
          }),
        });
        if (!response.ok) {
          const result = await response.json() as {
            error?: unknown;
            code?: unknown;
            tradeMayBeOpen?: unknown;
          };
          const tradeMayBeOpen = result.tradeMayBeOpen === true;
          runtime.inFlight = tradeMayBeOpen;
          runtime.unresolvedTrade = tradeMayBeOpen;
          runtime.running = false;
          setBotRunning(false);
          if (!tradeMayBeOpen) setOpenTradeDetails(null);
          const errorMessage = typeof result.error === "string"
            ? result.error
            : "Trade failed. The bot was stopped.";
          if (result.code === "SUBSCRIPTION_REQUIRED") {
            setActiveView("settings");
            void refreshSubscription();
          }
          notifyTradeError(errorMessage);
          setBotStatus(
            tradeMayBeOpen
              ? "Trade result unconfirmed. Check Deriv open positions; bot stopped."
              : errorMessage,
          );
          return;
        }

        if (!response.body) throw new Error("Deriv trade updates were unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let remaining = "";
        let settledProfit: number | null = null;
        let settledTrade: TradeHistoryEntry | null = null;
        let streamFailed = false;

        const handleTradeEvent = (line: string) => {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            throw new Error("Deriv returned an unreadable trade update.");
          }
          if (!event || typeof event !== "object") {
            throw new Error("Deriv returned an invalid trade update.");
          }
          const update = event as Record<string, unknown>;

          if (update.type === "purchased") {
            if (
              typeof update.stake !== "number" ||
              !Number.isFinite(update.stake) ||
              typeof update.payout !== "number" ||
              !Number.isFinite(update.payout) ||
              typeof update.currency !== "string" ||
              (update.contractType !== "CALL" && update.contractType !== "PUT")
            ) {
              throw new Error("Deriv returned invalid stake or payout details.");
            }
            setOpenTradeDetails({
              stake: update.stake,
              payout: update.payout,
              currency: update.currency,
              contractType: update.contractType,
            });
            return;
          }

          if (update.type === "progress") {
            if (
              typeof update.ticksPassed !== "number" ||
              !Number.isFinite(update.ticksPassed) ||
              typeof update.totalTicks !== "number" ||
              !Number.isFinite(update.totalTicks)
            ) {
              throw new Error("Deriv returned invalid contract progress.");
            }
            setTradeProgressTicks(Math.max(0, Math.min(5, update.ticksPassed)));
            return;
          }

          if (update.type === "settled") {
            if (
              typeof update.contractId !== "number" ||
              (update.contractType !== "CALL" && update.contractType !== "PUT") ||
              typeof update.stake !== "number" ||
              typeof update.payout !== "number" ||
              typeof update.currency !== "string" ||
              typeof update.profit !== "number" ||
              !Number.isFinite(update.profit)
            ) {
              throw new Error("Deriv returned an invalid contract result.");
            }
            settledProfit = update.profit;
            const completedAt = new Date().toISOString();
            settledTrade = {
              id: `${account.accountId}-${update.contractId}-${completedAt}`,
              contractId: update.contractId,
              contractType: update.contractType,
              stake: update.stake,
              payout: update.payout,
              currency: update.currency,
              profit: update.profit,
              completedAt,
            };
            setTradeProgressTicks(5);
            setOpenTradeDetails(null);
            return;
          }

          if (update.type === "error") {
            const tradeMayBeOpen = update.tradeMayBeOpen === true;
            runtime.inFlight = tradeMayBeOpen;
            runtime.unresolvedTrade = tradeMayBeOpen;
            runtime.running = false;
            setBotRunning(false);
            if (!tradeMayBeOpen) {
              setOpenTradeDetails(null);
              setTradeProgressTicks(0);
            }
            setBotStatus(
              tradeMayBeOpen
                ? "Trade result unconfirmed. Check Deriv open positions; bot stopped."
                : typeof update.error === "string" ? update.error : "Trade failed. Bot stopped.",
            );
            notifyTradeError(
              typeof update.error === "string" ? update.error : "Trade failed. The bot was stopped.",
            );
            streamFailed = true;
            return;
          }

          throw new Error("Deriv returned an unknown trade update.");
        };

        while (true) {
          const { value, done } = await reader.read();
          remaining += decoder.decode(value, { stream: !done });
          const lines = remaining.split("\n");
          remaining = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) handleTradeEvent(line);
            if (streamFailed) break;
          }
          if (streamFailed || done) break;
        }
        if (remaining.trim() && !streamFailed) handleTradeEvent(remaining);
        if (streamFailed) return;
        const completedTrade = settledTrade;
        if (settledProfit === null || completedTrade === null) {
          throw new Error("Deriv ended the trade stream before settlement.");
        }

        const profit = settledProfit;
        setTradeHistory((current) => [completedTrade, ...current].slice(0, 100));
        runtime.sessionProfit += profit;
        if (profit > 0) {
          runtime.nextStake = config.stakeAmount;
        } else if (profit < 0) {
          runtime.nextStake = Number((stake * 1.5).toFixed(2));
        }
        setPerformance((current) => ({
          profit: current.profit + profit,
          wins: current.wins + (profit > 0 ? 1 : 0),
          losses: current.losses + (profit < 0 ? 1 : 0),
          trades: current.trades + 1,
        }));

        if (runtime.sessionProfit >= botConfigRef.current.targetProfit) {
          runtime.running = false;
          runtime.sessionLimitReached = true;
          setBotRunning(false);
          setBotStatus("Session profit target reached");
        } else if (runtime.sessionProfit <= -botConfigRef.current.targetLoss) {
          runtime.running = false;
          runtime.sessionLimitReached = true;
          setBotRunning(false);
          setBotStatus("Session loss limit reached");
        } else {
          setBotStatus(
            runtime.running
              ? (profit >= 0 ? "Trade won" : "Trade lost")
              : "Bot stopped · current trade settled",
          );
        }
      } catch (error) {
        runtime.inFlight = true;
        runtime.unresolvedTrade = true;
        runtime.running = false;
        setBotRunning(false);
        const errorMessage = error instanceof Error
          ? error.message
          : "Trade result could not be confirmed.";
        notifyTradeError(`${errorMessage} Check Deriv positions before restarting.`);
        setBotStatus(
          `${errorMessage} Check Deriv positions before restarting.`,
        );
      } finally {
        if (!runtime.unresolvedTrade) runtime.inFlight = false;
        setTradeInProgress(runtime.inFlight || runtime.unresolvedTrade);
        if (!runtime.unresolvedTrade) setTradeProgressTicks(0);
        if (!runtime.inFlight) void refreshDerivAccounts();
      }
    })();
  }, [notifyTradeError, refreshDerivAccounts, refreshSubscription]);

  const disconnectDeriv = async () => {
    botRuntimeRef.current.running = false;
    setBotRunning(false);
    setDerivBusy(true);
    setDerivMessage("");
    try {
      const response = await fetch("/api/deriv/session/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Could not disconnect the Deriv account.");
      setDerivConnected(false);
      setDerivAccounts([]);
      setSelectedDerivAccountId("");
      setDerivMenuOpen(false);
      setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
      window.localStorage.removeItem("deriv-account-id");
      setDerivMessage("Your Deriv account has been disconnected.");
    } catch (error) {
      setDerivMessage(error instanceof Error ? error.message : "Could not disconnect the Deriv account.");
    } finally {
      setDerivBusy(false);
    }
  };

  const handleStartBot = () => {
    const runtime = botRuntimeRef.current;
    if (subscriptionLoading) return;
    if (subscription?.enabled && !subscription.active) {
      setBotStatus("An active subscription is required. Subscribe in Settings.");
      setActiveView("settings");
      return;
    }
    if (
      !derivConnected ||
      !selectedDerivAccount ||
      marketFeedStatus !== "Live" ||
      runtime.inFlight ||
      runtime.unresolvedTrade
    ) return;
    if (runtime.sessionLimitReached) {
      runtime.sessionProfit = 0;
      runtime.nextStake = botConfig.stakeAmount;
      runtime.sessionLimitReached = false;
      setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
    }
    runtime.running = true;
    runtime.nextStake ??= botConfig.stakeAmount;
    setBotRunning(true);
    setBotStatus(
      selectedDerivAccount.accountType === "real"
        ? "Watching market · real-account trades enabled"
        : "Watching market · demo account",
    );
  };

  const handleStopBot = () => {
    botRuntimeRef.current.running = false;
    setBotRunning(false);
    setBotStatus(
      botRuntimeRef.current.inFlight
        ? "Stopped · current contract will finish"
        : "Ready",
    );
  };

  const accountSummary = derivAccounts
    .map(({ accountType, currency }) => [accountType, currency].filter(Boolean).join(" · "))
    .join(", ");
  const formatBalance = (account: DerivAccount, compact = false) => {
    const currency = /^[A-Z]{3}$/.test(account.currency) ? account.currency : "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: compact ? "compact" : "standard",
        minimumFractionDigits: compact ? 0 : 2,
        maximumFractionDigits: compact ? 1 : 2,
      }).format(account.balance);
    } catch {
      return `$${account.balance.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  };
  const formatPerformanceAmount = (value: number) => {
    const currency = selectedDerivAccount?.currency ?? "USD";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };
  const formatTradeAmount = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };
  const decidedTrades = performance.wins + performance.losses;
  const hasReliableWinRate = decidedTrades >= 5;
  const winRate = hasReliableWinRate
    ? Math.round((performance.wins / decidedTrades) * 100)
    : 0;
  const selectDerivAccount = (account: DerivAccount) => {
    if (botRuntimeRef.current.running || botRuntimeRef.current.inFlight) return;
    botRuntimeRef.current = {
      running: false,
      inFlight: false,
      unresolvedTrade: false,
      sessionLimitReached: false,
      nextStake: null,
      sessionProfit: 0,
    };
    setPerformance({ profit: 0, wins: 0, losses: 0, trades: 0 });
    setSelectedDerivAccountId(account.accountId);
    window.localStorage.setItem("deriv-account-id", account.accountId);
    setDerivMenuOpen(false);
  };

  return (
    <main className="dashboard-shell">
      {tradeErrorToast && (
        <div className="trade-error-toast" role="alert" key={tradeErrorToast.id}>
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{tradeErrorToast.message}</span>
          <button
            type="button"
            aria-label="Dismiss trade error"
            onClick={() => {
              if (tradeToastTimerRef.current !== null) {
                window.clearTimeout(tradeToastTimerRef.current);
                tradeToastTimerRef.current = null;
              }
              setTradeErrorToast(null);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <header className="dashboard-header">
        <a href="#home" className="dashboard-brand" aria-label="G-Sync home">
          <span className="dashboard-brand-icon"><RobotLogo className="size-7" /></span>
          <span>G-Sync<span className="dashboard-brand-dot">.</span></span>
        </a>
        <div className="dashboard-header-actions">
          <span className="dashboard-live-indicator">
            <span className={socketOnline ? "status-dot status-dot-live" : "status-dot"} />
            {socketOnline ? "Synced" : "Offline"}
          </span>
          {derivConnected && selectedDerivAccount ? (
            <div className="deriv-account-switcher" ref={derivMenuRef}>
              <button
                type="button"
                className="deriv-header-button deriv-balance-button"
                onClick={() => setDerivMenuOpen((open) => !open)}
                disabled={derivBusy || botRunning || botRuntimeRef.current.inFlight}
                title={`${formatBalance(selectedDerivAccount)} · ${selectedDerivAccount.accountType} account · live balance updates${balanceRefreshError ? `. ${balanceRefreshError}` : ""}`}
                aria-label={`Deriv ${selectedDerivAccount.accountType} balance ${formatBalance(selectedDerivAccount)}. Updates live${balanceRefreshError ? `. Balance refresh issue: ${balanceRefreshError}` : ""}. Switch account`}
                aria-expanded={derivMenuOpen}
                aria-haspopup="menu"
                aria-controls="deriv-account-menu"
              >
                <span>{formatBalance(selectedDerivAccount, true)}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {derivMenuOpen && (
                <div className="deriv-account-menu" id="deriv-account-menu" role="menu" aria-label="Switch Deriv account">
                  {derivAccounts.map((account) => (
                    <button
                      type="button"
                      key={account.accountId}
                      className="deriv-account-option"
                      role="menuitemradio"
                      aria-checked={account.accountId === selectedDerivAccount.accountId}
                      onClick={() => selectDerivAccount(account)}
                      disabled={botRunning || botRuntimeRef.current.inFlight}
                    >
                      <span>
                        <strong>{account.accountType === "demo" ? "Demo" : "Real"}</strong>
                        <small>{account.currency}</small>
                      </span>
                      <span>{formatBalance(account)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="deriv-account-disconnect"
                    role="menuitem"
                    onClick={() => void disconnectDeriv()}
                    disabled={botRunning || botRuntimeRef.current.inFlight}
                  >
                    Disconnect Deriv
                  </button>
                </div>
              )}
            </div>
          ) : derivConnected ? (
            <button
              type="button"
              className="deriv-header-button"
              onClick={() => void disconnectDeriv()}
              disabled={derivBusy || botRunning || botRuntimeRef.current.inFlight}
              title={accountSummary || "No eligible Deriv accounts found"}
              aria-label="Deriv connected, disconnect account"
            >
              Connected
            </button>
          ) : (
            <a
              className="deriv-header-button"
              href="/api/deriv/oauth/start"
              aria-label="Connect and authorize your Deriv account"
              aria-disabled={derivBusy}
              title={derivBusy ? "Checking Deriv connection" : "Connect and authorize your Deriv account"}
              onClick={(event) => {
                if (derivBusy) event.preventDefault();
              }}
            >
              {derivBusy ? "…" : "Connect"}
            </a>
          )}
          <button type="button" className="dashboard-icon-button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section
        className={`dashboard-content ${activeView === "signals" || activeView === "settings" ? "dashboard-content-scroll" : "dashboard-content-pinned"}`}
        aria-label="Dashboard pages"
      >
        <div className="dashboard-home-view" id="dashboard-home-view" hidden={activeView !== "home"}>
            <div className="dashboard-greeting">
              <div>
                <p className="dashboard-eyebrow">TRADING OVERVIEW</p>
                <h1 id="dashboard-title">Your dashboard</h1>
                <p className="dashboard-subtitle">{email || "Your G-Sync account"}</p>
              </div>
              <span className="market-session">
                <span className={`status-dot ${marketFeedStatus === "Live" ? "status-dot-live" : "status-dot-waiting"}`} />
                {marketFeedStatus === "Live" ? "Market live" : `Market ${marketFeedStatus.toLowerCase()}`}
              </span>
            </div>

            <MarketConsole onMarketSignal={handleMarketSignal} onFeedStatus={handleFeedStatus} />

            <section
              className="performance-panel"
              aria-label="Trading performance"
              key={selectedDerivAccountId || "no-account"}
            >
              <div className="performance-heading">
                <div>
                  <h2>Bot performance</h2>
                  <p>Session summary</p>
                </div>
                <button type="button" className="help-button" aria-label="Performance help" title="Performance updates after your Deriv account is connected">
                  <CircleHelp size={17} />
                </button>
              </div>
              <div className="performance-metrics">
                <div className="performance-metric">
                  <span>P/L</span>
                  <strong
                    key={`profit-${performance.trades}`}
                    className={performance.profit > 0 ? "performance-positive" : performance.profit < 0 ? "performance-negative" : ""}
                  >
                    {derivConnected ? formatPerformanceAmount(performance.profit) : "--"}
                  </strong>
                </div>
                <div className="performance-metric">
                  <span>W</span>
                  <strong key={`wins-${performance.trades}`}>{performance.wins}</strong>
                </div>
                <div className="performance-metric">
                  <span>L</span>
                  <strong key={`losses-${performance.trades}`}>{performance.losses}</strong>
                </div>
                <div className="performance-metric performance-rate">
                  <span>Win rate</span>
                  <div
                    className="rate-ring"
                    title="Based on saved completed trades for this account; breakeven trades are excluded. Shown after five decided trades."
                    style={{
                      background: `conic-gradient(#bff6df ${winRate}%, rgb(255 255 255 / 25%) ${winRate}% 100%)`,
                    }}
                    aria-label={
                      hasReliableWinRate
                        ? `Win rate ${winRate} percent from ${decidedTrades} trades`
                        : `Win rate shown after five decided trades; ${decidedTrades} decided so far`
                    }
                  >
                    <span>{hasReliableWinRate ? `${winRate}%` : "--"}</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="home-bot-controls" aria-label="Bot controls">
              <div className="bot-trade-progress" role="status" aria-live="polite">
                <div className="bot-trade-progress-heading">
                  <span>Open trade progress</span>
                  <span>{tradeInProgress ? "In progress" : "No open trade"}</span>
                </div>
                <div
                  className="bot-trade-progress-track"
                  role="progressbar"
                  aria-label="Trade progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((tradeProgressTicks / 5) * 100)}
                  aria-valuetext={tradeInProgress ? "Trade is being processed and awaiting settlement" : "No open trade"}
                >
                  <span style={{ width: `${(tradeProgressTicks / 5) * 100}%` }} />
                </div>
                <div className="bot-trade-values" aria-live="polite">
                  {openTradeDetails ? (
                    <>
                      <span>{openTradeDetails.contractType === "CALL" ? "BUY" : "SELL"}</span>
                      <span>Stake {formatTradeAmount(openTradeDetails.stake, openTradeDetails.currency)}</span>
                      <span>Potential payout {formatTradeAmount(openTradeDetails.payout, openTradeDetails.currency)}</span>
                    </>
                  ) : tradeInProgress ? (
                    <span>Waiting for Deriv contract details…</span>
                  ) : (
                    <span>No active contract</span>
                  )}
                </div>
                <span className="sr-only">{botStatus}</span>
              </div>
              {derivMessage && <span className="sr-only" role="status">{derivMessage}</span>}
              <div className="bot-controls">
                <button
                  type="button"
                  className="bot-start-button"
                  onClick={handleStartBot}
                  disabled={!derivConnected || !selectedDerivAccount || derivBusy || botRunning || marketFeedStatus !== "Live" || botRuntimeRef.current.unresolvedTrade || subscriptionLoading || (subscription?.enabled === true && !subscription.active)}
                  title={botRuntimeRef.current.unresolvedTrade ? "Check Deriv open positions before starting again" : undefined}
                >
                  Start bot
                </button>
                <button
                  type="button"
                  className="bot-stop-button"
                  onClick={handleStopBot}
                  disabled={!botRunning}
                >
                  Stop
                </button>
              </div>
              <p className={`dashboard-disclaimer ${selectedDerivAccount?.accountType === "real" ? "dashboard-disclaimer-real" : ""}`}>
                {botRuntimeRef.current.unresolvedTrade
                  ? "A trade result is unconfirmed. Verify open positions in Deriv before reloading or restarting."
                  : selectedDerivAccount?.accountType === "real"
                    ? "Real account selected. Starting the bot can place live trades."
                    : "Demo account selected. Your configured session limits are active."}
              </p>
            </div>
        </div>
        <div className="dashboard-config-view" id="dashboard-config-view" hidden={activeView !== "signals"}>
          <SignalPage
            botConfig={botConfig}
            onConfigChange={setBotConfig}
          />
        </div>
        <div className="dashboard-history-view" id="dashboard-history-view" hidden={activeView !== "history"}>
          <section className="market-panel history-panel" aria-label="Completed bot trade history">
            <header className="history-heading">
              <h2>Trade history</h2>
            </header>
            {!historyReady || historyAccountId !== selectedDerivAccountId ? (
              <p className="history-empty">Loading trade history…</p>
            ) : !derivConnected || !selectedDerivAccountId ? (
              <p className="history-empty">Connect a Deriv account to view its trade history.</p>
            ) : accountTrades.length === 0 ? (
              <p className="history-empty">No completed bot trades for this account yet.</p>
            ) : (
              <div className="history-table-viewport">
                <table className="history-table">
                  <caption className="sr-only">Completed trades showing direction, stake, profit, and status</caption>
                  <thead>
                    <tr>
                      <th scope="col">Direction</th>
                      <th scope="col">Stake</th>
                      <th scope="col">Profit</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountTrades.map((trade) => {
                      const status = trade.profit > 0 ? "win" : trade.profit < 0 ? "loss" : "even";
                      return (
                        <tr key={trade.id}>
                          <td>
                            <span
                              className={`history-direction history-direction-${trade.contractType.toLowerCase()}`}
                              role="img"
                              aria-label={trade.contractType === "CALL" ? "Buy" : "Sell"}
                              title={trade.contractType === "CALL" ? "Buy" : "Sell"}
                            >
                              {trade.contractType === "CALL"
                                ? <ArrowUpRight size={17} aria-hidden="true" />
                                : <ArrowDownRight size={17} aria-hidden="true" />}
                            </span>
                            <span className="history-direction-label">
                              {trade.contractType === "CALL" ? "BUY" : "SELL"}
                            </span>
                          </td>
                          <td>{formatTradeAmount(trade.stake, trade.currency)}</td>
                          <td className={trade.profit > 0 ? "performance-positive" : trade.profit < 0 ? "performance-negative" : ""}>
                            {formatTradeAmount(trade.profit, trade.currency)}
                          </td>
                          <td>
                            <span className={`history-status history-status-${status}`}>
                              {status === "win" ? "Won" : status === "loss" ? "Lost" : "Even"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <div className="dashboard-settings-view" id="dashboard-settings-view" hidden={activeView !== "settings"}>
          <SettingsPage
            accountId={accountId}
            username={username}
            email={email}
            subscription={subscription}
            subscriptionLoading={subscriptionLoading}
            subscriptionError={subscriptionError}
            payment={subscriptionPayment}
            paymentHistory={paymentHistory}
            paymentHistoryLoading={paymentHistoryLoading}
            paymentHistoryError={paymentHistoryError}
            paymentBusy={paymentBusy}
            onSubscribe={() => void handleSubscribe()}
          />
        </div>
      </section>

      <nav className="dashboard-bottom-nav" aria-label="Main navigation">
        <button type="button" className={`bottom-nav-item ${activeView === "home" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("home")} aria-current={activeView === "home" ? "page" : undefined} aria-controls="dashboard-home-view">
          <Home size={19} /><span>Home</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "signals" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("signals")} aria-current={activeView === "signals" ? "page" : undefined} aria-controls="dashboard-config-view">
          <Activity size={19} /><span>Configure</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "history" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("history")} aria-current={activeView === "history" ? "page" : undefined} aria-controls="dashboard-history-view">
          <Clock3 size={19} /><span>History</span>
        </button>
        <button type="button" className={`bottom-nav-item ${activeView === "settings" ? "bottom-nav-active" : ""}`} onClick={() => setActiveView("settings")} aria-current={activeView === "settings" ? "page" : undefined} aria-controls="dashboard-settings-view">
          <Settings2 size={19} /><span>Settings</span>
        </button>
      </nav>
    </main>
  );
}