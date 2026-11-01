import { PaymentReturnPage } from "@/components/payment-return-page";

type PaymentStatusPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>;
};

export default async function PaymentStatusPage({ searchParams }: PaymentStatusPageProps) {
  const { order_id: orderId } = await searchParams;
  return <PaymentReturnPage mode="status" orderId={typeof orderId === "string" ? orderId : ""} />;
}
