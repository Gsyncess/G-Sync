import { redirect } from "next/navigation";

type PaymentStatusPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>;
};

export default async function PaymentStatusPage({ searchParams }: PaymentStatusPageProps) {
  const { order_id: orderId } = await searchParams;
  const paymentOrder = typeof orderId === "string" ? orderId : "";
  redirect(`/?payment_order=${encodeURIComponent(paymentOrder)}&payment_mode=status`);
}
