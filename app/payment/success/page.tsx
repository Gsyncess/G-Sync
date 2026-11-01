import { PaymentReturnPage } from "@/components/payment-return-page";

type PaymentSuccessPageProps = {
  searchParams: Promise<{ order_id?: string | string[] }>;
};

export default async function PaymentSuccessPage({ searchParams }: PaymentSuccessPageProps) {
  const { order_id: orderId } = await searchParams;
  return <PaymentReturnPage mode="success" orderId={typeof orderId === "string" ? orderId : ""} />;
}
