"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BadgeCheck, Check, CircleAlert, Clock3, Copy, LoaderCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type PaymentReturnMode = "status" | "success" | "failed";

type PaymentDetails = {
  paymentId: string;
  orderId: string;
  payAddress: string;
  status: string;
  payAmount: number;
  payCurrency: string;
  qrCode: string | null;
  subscriptionExpiresAt: string | null;
};

type PaymentReturnPageProps = {
  mode: PaymentReturnMode;
  orderId: string;
  onBackToSettings: () => void;
  onGoToDashboard: () => void;
  onPaymentComplete: (expiresAt: string) => void;
};

const terminalStatuses = new Set(["completed", "error", "cancelled", "expired", "mismatch"]);

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    new: "Awaiting payment",
    pending: "Awaiting payment",
    completed: "Payment complete",
    error: "Payment failed",
    cancelled: "Payment cancelled",
    expired: "Payment expired",
    mismatch: "Payment needs review",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function statusMessage(status: string) {
  if (status === "completed") return "Payment confirmed. Your bot subscription is active.";
  if (status === "error" || status === "cancelled" || status === "expired") {
    return "This payment was not completed. You can return to Settings to try again.";
  }
  if (status === "mismatch") return "The payment could not be matched. Contact support before trying again.";
  return "Waiting for payment confirmation.";
}

export function PaymentReturnPage({
  mode,
  orderId,
  onBackToSettings,
  onGoToDashboard,
  onPaymentComplete,
}: PaymentReturnPageProps) {
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const paymentStatusRef = useRef("");
  const reportedExpiryRef = useRef("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        if (!orderId) throw new Error("The payment order could not be identified.");
        if (!supabase) throw new Error("Sign in to verify your payment.");
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("Sign in to verify your payment.");

        const response = await fetch(`/api/subscription/payments/order/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json() as PaymentDetails & { error?: unknown };
        if (!response.ok || typeof result.status !== "string") {
          throw new Error(typeof result.error === "string" ? result.error : "Could not verify payment status.");
        }
        if (active) {
          paymentStatusRef.current = result.status;
          setPayment(result);
          setError("");
          if (result.status === "completed" && result.subscriptionExpiresAt &&
            reportedExpiryRef.current !== result.subscriptionExpiresAt) {
            reportedExpiryRef.current = result.subscriptionExpiresAt;
            onPaymentComplete(result.subscriptionExpiresAt);
          }
        }
      } catch (refreshError) {
        if (active) {
          setError(refreshError instanceof Error ? refreshError.message : "Could not verify payment status.");
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      if (!terminalStatuses.has(paymentStatusRef.current)) void refresh();
    }, 4000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [onPaymentComplete, orderId]);

  const paymentStatus = payment?.status ?? "";
  const subscriptionExpiry = payment?.subscriptionExpiresAt;
  const formattedSubscriptionExpiry = subscriptionExpiry
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(subscriptionExpiry))
    : null;
  const isComplete = paymentStatus === "completed";
  const isFailed = ["error", "cancelled", "expired", "mismatch"].includes(paymentStatus);
  const isPending = !isComplete && !isFailed;
  const showIcon = isComplete
    ? <BadgeCheck size={26} aria-hidden="true" />
    : mode === "failed" || isFailed
      ? <CircleAlert size={26} aria-hidden="true" />
      : <Clock3 size={26} aria-hidden="true" />;
  const heading = isComplete
    ? "Payment confirmed"
    : isFailed
      ? "Payment not completed"
      : mode === "status"
        ? "Payment awaiting confirmation"
        : mode === "failed"
          ? "Payment not completed"
          : "Confirming your payment";
  const copyPaymentAddress = async () => {
    if (!payment?.payAddress) return;
    try {
      await navigator.clipboard.writeText(payment.payAddress);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch (copyError) {
      console.error("Could not copy the payment address.", copyError);
      setError("Could not copy the address. Select and copy it manually.");
    }
  };

  return (
    <section className="payment-return-panel">
      <button type="button" className="payment-return-back" onClick={onBackToSettings}>
        <span aria-hidden="true">←</span> Back to Settings
      </button>
      <div className="payment-return-card">
        <div className={`payment-return-icon ${isComplete ? "payment-return-icon-success" : isFailed ? "payment-return-icon-failed" : ""}`}>
          {payment ? showIcon : <LoaderCircle className="checkout-spinner-icon" size={26} aria-hidden="true" />}
        </div>
        <p className="checkout-eyebrow">BOT SUBSCRIPTION</p>
        <h1>{heading}</h1>
        <p>{payment ? statusMessage(payment.status) : "Checking the payment status with G-Sync…"}</p>
        {error && <p className="settings-error" role="alert">{error}</p>}
        {payment && (
          <>
            <div className={`payment-status payment-status-${payment.status}`} role="status" aria-live="polite">
              <span className="status-dot" />
              {formatStatus(payment.status)}
            </div>
            {isPending && (
              <>
                <p className="payment-return-amount">
                  Send exactly {payment.payAmount} {payment.payCurrency.toUpperCase()}
                </p>
                {payment.qrCode && (
                  <Image
                    className="payment-return-qr"
                    src={payment.qrCode}
                    alt="Payment QR code"
                    width={220}
                    height={220}
                    unoptimized
                  />
                )}
                <span className="payment-address-label">Payment address</span>
                <code className="payment-return-address">{payment.payAddress}</code>
                <button type="button" className="payment-copy-button" onClick={() => void copyPaymentAddress()}>
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  {copied ? "Address copied" : "Copy payment address"}
                </button>
              </>
            )}
            {isPending && (
              <p className="payment-return-note">
                Keep this page open while your payment is confirmed. Your subscription will activate automatically once payment is verified.
              </p>
            )}
          </>
        )}
        {isComplete && (
          <>
            {formattedSubscriptionExpiry && <p className="payment-return-note">Access until {formattedSubscriptionExpiry}</p>}
            <button type="button" className="subscription-start-button payment-return-link" onClick={onGoToDashboard}>
              Continue to dashboard
            </button>
          </>
        )}
        {payment && <code className="checkout-order-id">{payment.orderId}</code>}
      </div>
    </section>
  );
}
