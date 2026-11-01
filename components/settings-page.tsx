"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Clock3,
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
  qrCode: string | null;
  priceAmount: number;
  priceCurrency: string;
  status: string;
};

export type PaymentCurrency = {
  id: string;
  name: string;
  network: string | null;
};

export type SubscriptionPaymentRecord = {
  paymentId: string;
  priceAmount: number;
  priceCurrency: string;
  payAmount: number | null;
  payCurrency: string | null;
  status: string;
  createdAt: string;
  activatedAt: string | null;
};

type SettingsPageProps = {
  accountId: string;
  accountIdError: string;
  username: string;
  email: string;
  subscription: AppSubscription | null;
  subscriptionLoading: boolean;
  subscriptionError: string;
  checkoutOpen: boolean;
  paymentHistory: SubscriptionPaymentRecord[];
  paymentHistoryLoading: boolean;
  paymentHistoryError: string;
  paymentCurrencies: PaymentCurrency[];
  paymentCurrenciesLoading: boolean;
  paymentBusy: boolean;
  onStartCheckout: () => void;
  onSubscribe: (currency: string) => void;
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
    new: "Waiting for payment",
    pending: "Waiting for payment",
    waiting: "Waiting for payment",
    completed: "Payment complete",
    error: "Payment failed",
    cancelled: "Payment cancelled",
    expired: "Payment expired",
    mismatch: "Payment mismatch",
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
  accountIdError,
  username,
  email,
  subscription,
  subscriptionLoading,
  subscriptionError,
  checkoutOpen,
  paymentHistory,
  paymentHistoryLoading,
  paymentHistoryError,
  paymentCurrencies,
  paymentCurrenciesLoading,
  paymentBusy,
  onStartCheckout,
  onSubscribe,
  onBackFromCheckout,
}: SettingsPageProps) {
  const [selectedCurrency, setSelectedCurrency] = useState("");
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
    if (!paymentCurrencies.some((currency) => currency.id === selectedCurrency)) {
      setSelectedCurrency(paymentCurrencies[0]?.id ?? "");
    }
  }, [paymentCurrencies, selectedCurrency]);

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
          <h1>Choose a payment currency</h1>
          <p className="checkout-subtitle">Select a supported currency. Payment details and confirmation stay in this app.</p>
          <div className="checkout-order-card">
            <div className="checkout-order-price">
              <span>Subscription</span>
              <strong>$5.00 USD</strong>
            </div>
            <div className="checkout-order-duration">12 hours of bot access</div>
          </div>
          {subscriptionError && <p className="settings-error" role="alert">{subscriptionError}</p>}
          {paymentCurrenciesLoading ? (
            <div className="checkout-loading" role="status">
              <span className="checkout-spinner" />
              <span>Loading available payment options…</span>
            </div>
          ) : paymentCurrencies.length > 0 ? (
            <>
              <label className="payment-currency-field">
                <span>Currency and network</span>
                <select
                  value={selectedCurrency}
                  onChange={(event) => setSelectedCurrency(event.target.value)}
                  disabled={paymentBusy}
                >
                  {paymentCurrencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.name}{currency.network ? ` · ${currency.network}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="subscription-start-button"
                disabled={!selectedCurrency || paymentBusy}
                onClick={() => onSubscribe(selectedCurrency)}
              >
                {paymentBusy ? "Preparing secure payment…" : "Continue"}
              </button>
            </>
          ) : (
            <button type="button" className="subscription-start-button checkout-retry-button" onClick={onStartCheckout}>
              Try loading payment options again
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
          {accountIdError && <p className="settings-error profile-account-error" role="alert">{accountIdError}</p>}
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
            Pay $5 USD using a supported crypto currency and network. Payment instructions appear securely in this app.
          </p>
          {subscriptionError && <p className="settings-error" role="alert">{subscriptionError}</p>}
          <button
            type="button"
            className="subscription-start-button"
            disabled={paymentBusy || subscriptionLoading}
            onClick={onStartCheckout}
          >
            {paymentBusy ? "Preparing secure payment…" : "Subscribe for $5"}
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
                    <span className={`subscription-badge ${
                      record.status === "completed"
                        ? "subscription-badge-active"
                        : ["error", "cancelled", "expired", "mismatch"].includes(record.status)
                          ? "subscription-badge-expired"
                          : ""
                    }`}>
                      {formatPaymentStatus(record.status)}
                    </span>
                    <strong>
                      {record.payAmount !== null && record.payCurrency
                        ? `${record.payAmount} ${record.payCurrency.toUpperCase()}`
                        : `$${record.priceAmount.toFixed(2)} ${record.priceCurrency}`}
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
