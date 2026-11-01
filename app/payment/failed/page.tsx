import { PaymentReturnPage } from "@/components/payment-return-page";

type PaymentFailedPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>;
};

export default async function PaymentFailedPage({ searchParams }: PaymentFailedPageProps) {
  const { order_id: orderId } = await searchParams;
  return <PaymentReturnPage mode="failed" orderId={typeof orderId === "string" ? orderId : ""} />;
}
