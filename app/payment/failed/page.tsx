import { redirect } from "next/navigation";

type PaymentFailedPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>;
};

export default async function PaymentFailedPage({ searchParams }: PaymentFailedPageProps) {
  const { order_id: orderId } = await searchParams;
  const paymentOrder = typeof orderId === "string" ? orderId : "";
  redirect(`/?payment_order=${encodeURIComponent(paymentOrder)}&payment_mode=failed`);
}
