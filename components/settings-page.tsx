"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Clock3,
  Copy,
  CreditCard,
  Fingerprint,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export type AppSubscription = {
  enabled: boolean;
  active: boolean;
  expiresAt: string | null;
};

export type SubscriptionPayment = {
  paymentId: string;
  orderId: string;
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
  checkoutOpen: boolean;
  paymentHistory: SubscriptionPaymentRecord[];
  paymentHistoryLoading: boolean;
  paymentHistoryError: string;
  paymentBusy: boolean;
  onSubscribe: () => void;
  onBackFromCheckout: () => void;
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
  checkoutOpen,
  paymentHistory,
  paymentHistoryLoading,
  paymentHistoryError,
  paymentBusy,
  onSubscribe,
  onBackFromCheckout,
}: SettingsPageProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const avatar = avatarColors[
    Array.from(accountId).reduce((sum, character) => sum + character.charCodeAt(0), 0) % avatarColors.length
  ];
  const expiresAt = formatExpiry(subscription?.expiresAt ?? null);
  const initials = username
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || email.slice(0, 1).toUpperCase() || "U";

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

  if (checkoutOpen) {
    return (
      <section className="subscription-checkout" aria-label="Subscription payment">
        <button
          type="button"
          className="checkout-back-button"
          onClick={onBackFromCheckout}
          aria-label="Back to settings"
        >
          <ArrowLeft size={20} aria-hidden="true" />
          <span>Back</span>
        </button>
        <div className="checkout-content">
          <div className="checkout-icon"><CreditCard size={22} aria-hidden="true" /></div>
          <p className="checkout-eyebrow">BOT SUBSCRIPTION</p>
          <h1>Complete your payment</h1>
          <p className="checkout-subtitle">Your bot access starts automatically after NOWPayments confirms your payment.</p>
          <div className="checkout-order-card">
            <div className="checkout-order-price">
              <span>Subscription</span>
              <strong>$5.00 USD</strong>
            </div>
            <div className="checkout-order-duration">12 hours of bot access</div>
            {payment?.orderId && (
              <div className="checkout-order-id">
                <span>Order ID</span>
                <code>{payment.orderId}</code>
              </div>
            )}
          </div>
          {subscriptionError && <p className="settings-error" role="alert">{subscriptionError}</p>}
          {paymentBusy && !payment ? (
            <div className="checkout-loading" role="status">
              <span className="checkout-spinner" />
              <span>Preparing your secure payment…</span>
            </div>
          ) : payment ? (
            <div className="checkout-payment-details" aria-live="polite">
              <div className={`payment-status payment-status-${payment.status}`}>
                <span className="status-dot" />
                {formatPaymentStatus(payment.status)}
              </div>
              {payment.status === "finished" ? (
                <div className="checkout-payment-complete" role="status">
                  <BadgeCheck size={24} aria-hidden="true" />
                  <strong>Payment confirmed</strong>
                  <span>Your subscription is active. You can return to Settings.</span>
                </div>
              ) : ["failed", "refunded", "expired"].includes(payment.status) ? (
                <p className="checkout-payment-note">
                  This payment is {payment.status}. Return to Settings to start a new payment.
                </p>
              ) : (
                <>
                  <div className="checkout-crypto-amount">
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
                    Pay from your wallet using USDT on the TRC20 network. No amount entry or NOWPayments website is needed.
                  </p>
                </>
              )}
            </div>
          ) : (
            <button type="button" className="subscription-start-button checkout-retry-button" onClick={onSubscribe}>
              Try payment again
            </button>
          )}
          <p className="checkout-account-note">
            Payment order for {username || "User"}{email ? ` · ${email}` : ""}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-page" aria-label="Profile and subscription settings">
      <header className="settings-page-heading">
        <div>
          <p className="settings-page-eyebrow">ACCOUNT</p>
          <h1>My profile</h1>
          <p>Your personal details and bot membership.</p>
        </div>
      </header>

      <article className="settings-card profile-settings-card">
        <div className="profile-cover">
          <div
            className="profile-avatar"
            style={{ backgroundColor: avatar.background, color: avatar.color }}
            aria-label={`${username || "User"} profile avatar`}
            role="img"
          >
            {initials}
          </div>
          <div className="profile-identity">
            <h2>{username || "User"}</h2>
            <p>{email || "Email unavailable"}</p>
          </div>
          {subscription?.enabled && (
            <span className={`profile-membership ${subscription.active ? "profile-membership-active" : "profile-membership-expired"}`}>
              {subscription.active ? <BadgeCheck size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
              {subscriptionLoading ? "Checking" : subscription.active ? "Member" : "Expired"}
            </span>
          )}
        </div>
        <div className="profile-details">
          <div className="profile-detail-row">
            <span className="profile-detail-icon"><UserRound size={16} aria-hidden="true" /></span>
            <span className="profile-detail-label">Username</span>
            <strong>{username || "User"}</strong>
          </div>
          <div className="profile-detail-row">
            <span className="profile-detail-icon"><Mail size={16} aria-hidden="true" /></span>
            <span className="profile-detail-label">Email</span>
            <strong>{email || "Email unavailable"}</strong>
          </div>
          <div className="profile-detail-row profile-detail-row-id">
            <span className="profile-detail-icon"><Fingerprint size={16} aria-hidden="true" /></span>
            <span className="profile-detail-label">Account ID</span>
            <code>{accountId || "Unavailable"}</code>
          </div>
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

      {subscription?.enabled && !subscription.active && (
        <article className="settings-card subscription-payment-card">
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><CreditCard size={18} aria-hidden="true" /></div>
            <div>
              <h2>Subscribe to the bot</h2>
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
          <button
            type="button"
            className="subscription-start-button"
            disabled={paymentBusy || subscriptionLoading}
            onClick={onSubscribe}
          >
            {paymentBusy ? "Preparing in-app payment…" : "Subscribe for $5"}
          </button>
        </article>
      )}

      {subscription?.enabled && (
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
      )}

      {!subscription && (subscriptionLoading || subscriptionError) ? (
        <article className="settings-card subscription-status-card" role={subscriptionError ? "alert" : "status"}>
          <div className="settings-card-heading">
            <div className="settings-heading-icon"><ShieldCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>Bot subscription</h2>
              <p>{subscriptionError || "Checking your subscription settings…"}</p>
            </div>
          </div>
        </article>
      ) : subscription && !subscription.enabled ? (
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
      ) : null}
    </section>
  );
}
