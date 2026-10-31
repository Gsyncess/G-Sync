"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleUserRound,
  Clock3,
  Copy,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

export type AppSubscription = {
  enabled: boolean;
  active: boolean;
  expiresAt: string | null;
};

export type SubscriptionPayment = {
  paymentId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  priceAmount: number;
  priceCurrency: string;
  expiresAt: string | null;
  status: string;
};

export type SubscriptionPaymentRecord = {
  paymentId: string;
  priceAmount: number;
  priceCurrency: string;
  payAmount: number;
  payCurrency: string;
  actuallyPaid: number | null;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  activatedAt: string | null;
};

type SettingsPageProps = {
  accountId: string;
  username: string;
  email: string;
  subscription: AppSubscription | null;
  subscriptionLoading: boolean;
  subscriptionError: string;
  payment: SubscriptionPayment | null;
  paymentHistory: SubscriptionPaymentRecord[];
  paymentHistoryLoading: boolean;
  paymentHistoryError: string;
  paymentBusy: boolean;
  onSubscribe: () => void;
};

const avatarColors = [
  { background: "#e5f4ee", color: "#117968" },
  { background: "#e9effb", color: "#455d99" },
  { background: "#f7eafa", color: "#83528b" },
  { background: "#fff1df", color: "#9b6825" },
];

function formatExpiry(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPaymentStatus(status: string) {
  const labels: Record<string, string> = {
    waiting: "Waiting for payment",
    confirming: "Confirming payment",
    confirmed: "Payment confirmed",
    sending: "Payment processing",
    partially_paid: "Payment incomplete",
    finished: "Payment complete",
    failed: "Payment failed",
    refunded: "Payment refunded",
    expired: "Payment expired",
  };
  return labels[status] ?? "Checking payment";
}

function formatPaymentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function SettingsPage({
  accountId,
  username,
  email,
  subscription,
  subscriptionLoading,
  subscriptionError,
  payment,
  paymentHistory,
  paymentHistoryLoading,
  paymentHistoryError,
  paymentBusy,
  onSubscribe,
}: SettingsPageProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const avatar = avatarColors[
    Array.from(accountId).reduce((sum, character) => sum + character.charCodeAt(0), 0) % avatarColors.length
  ];
  const expiresAt = formatExpiry(subscription?.expiresAt ?? null);

  useEffect(() => {
    setCopyError("");
    setCopied(false);
  }, [payment?.paymentId]);

  const copyAddress = async () => {
    if (!payment) return;
    try {
      await navigator.clipboard.writeText(payment.payAddress);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error("Could not copy subscription payment address.", error);
      setCopyError("Could not copy the address. Select and copy it manually.");
    }
  };

  return (
    <section className="settings-page" aria-label="Profile and subscription settings">
      <header className="settings-page-heading">
        <h1>Settings</h1>
        <p>Manage your profile and bot subscription.</p>
      </header>

      <article className="settings-card profile-settings-card">
        <div className="settings-card-heading">
          <div className="settings-heading-icon"><CircleUserRound size={18} aria-hidden="true" /></div>
          <div>
            <h2>Your profile</h2>
            <p>Your G-Sync account details</p>
          </div>
        </div>
        <div className="profile-summary">
          <div
            className="profile-avatar"
            style={{ backgroundColor: avatar.background, color: avatar.color }}
            aria-hidden="true"
          >
            <CircleUserRound size={31} />
          </div>
          <div className="profile-name">
            <strong>{username || "User"}</strong>
            <span>{email || "Email unavailable"}</span>
          </div>
        </div>
        <div className="profile-account-id">
          <span>Account ID</span>
          <code>{accountId || "Unavailable"}</code>
        </div>
      </article>

      {subscription?.enabled && (
        <article className="settings-card subscription-status-card">
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><ShieldCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>Bot subscription</h2>
              <p>Access to automated trading</p>
            </div>
            <span className={`subscription-badge ${subscription.active ? "subscription-badge-active" : "subscription-badge-expired"}`}>
              {subscription.active ? <BadgeCheck size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}
              {subscriptionLoading ? "Checking" : subscription.active ? "Active" : "Expired"}
            </span>
          </div>
          <div className="subscription-expiry">
            <Clock3 size={16} aria-hidden="true" />
            <span>
              {subscriptionLoading
                ? "Checking subscription expiry…"
                : subscription.active && expiresAt
                  ? `Access until ${expiresAt}`
                  : "No active bot subscription"}
            </span>
          </div>
          <p className="subscription-duration-note">
            Each payment provides 12 hours of bot access. Renewals extend from your current expiry.
          </p>
        </article>
      )}

      {subscription?.enabled ? (
        <>
        <article className="settings-card subscription-payment-card">
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><CreditCard size={18} aria-hidden="true" /></div>
            <div>
              <h2>{subscription.active ? "Renew subscription" : "Subscribe to the bot"}</h2>
              <p>Secure in-app crypto payment</p>
            </div>
          </div>
          <div className="subscription-price">
            <strong>$5</strong>
            <span>/ 12 hours</span>
          </div>
          <p className="subscription-payment-description">
            Pay exactly the amount shown in USDT on the TRC20 network. Payment instructions stay in this app.
          </p>
          {subscriptionError && <p className="settings-error" role="alert">{subscriptionError}</p>}
          {payment && !["failed", "refunded", "expired"].includes(payment.status) ? (
            <div className="payment-instructions" aria-live="polite">
              <div className={`payment-status payment-status-${payment.status}`}>
                <span className="status-dot" />
                {formatPaymentStatus(payment.status)}
              </div>
              <div className="payment-amount">
                <span>Send exactly</span>
                <strong>{payment.payAmount} {payment.payCurrency.toUpperCase()}</strong>
              </div>
              <div className="payment-network">Network: TRON (TRC20)</div>
              <span className="payment-address-label">Payment address</span>
              <code className="payment-address">{payment.payAddress}</code>
              <button type="button" className="payment-copy-button" onClick={() => void copyAddress()}>
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                {copied ? "Address copied" : "Copy address"}
              </button>
              {copyError && <p className="settings-error" role="alert">{copyError}</p>}
              <p className="payment-safety-note">
                Only send USDT using the TRC20 network and the exact amount above. Access activates after the payment is confirmed.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="subscription-start-button"
              disabled={paymentBusy || subscriptionLoading}
              onClick={onSubscribe}
            >
              {paymentBusy ? "Preparing in-app payment…" : subscription.active ? "Renew for $5" : "Subscribe for $5"}
            </button>
          )}
        </article>
        <article className="settings-card payment-history-card">
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><Clock3 size={18} aria-hidden="true" /></div>
            <div>
              <h2>Payment history</h2>
              <p>Subscription payment records</p>
            </div>
          </div>
          {paymentHistoryError ? (
            <p className="settings-error" role="alert">{paymentHistoryError}</p>
          ) : paymentHistoryLoading ? (
            <p className="payment-history-empty">Loading payment records…</p>
          ) : paymentHistory.length === 0 ? (
            <p className="payment-history-empty">No subscription payments recorded yet.</p>
          ) : (
            <ul className="payment-history-list">
              {paymentHistory.map((record) => (
                <li className="payment-history-item" key={record.paymentId}>
                  <div className="payment-history-main">
                    <span className={`subscription-badge ${record.status === "finished" ? "subscription-badge-active" : "subscription-badge-expired"}`}>
                      {formatPaymentStatus(record.status)}
                    </span>
                    <strong>
                      {record.actuallyPaid !== null
                        ? `${record.actuallyPaid} ${record.payCurrency.toUpperCase()}`
                        : `${record.payAmount} ${record.payCurrency.toUpperCase()}`}
                    </strong>
                  </div>
                  <span className="payment-history-date">{formatPaymentDate(record.createdAt)}</span>
                  <code className="payment-history-id">Transaction {record.paymentId}</code>
                  {record.activatedAt && (
                    <span className="payment-history-date">Subscription activated {formatPaymentDate(record.activatedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
        </>
      ) : subscriptionLoading || subscriptionError ? (
        <article className="settings-card subscription-status-card" role={subscriptionError ? "alert" : "status"}>
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><ShieldCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>Bot subscription</h2>
              <p>{subscriptionError || "Checking your subscription settings…"}</p>
            </div>
          </div>
        </article>
      ) : (
        <article className="settings-card subscription-status-card subscription-free-card">
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><BadgeCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>Bot access</h2>
              <p>Subscription payments are disabled</p>
            </div>
            <span className="subscription-badge subscription-badge-active">Free access</span>
          </div>
          <p className="subscription-duration-note">
            You can use the bot without a subscription.
          </p>
        </article>
      )}
    </section>
  );
}
