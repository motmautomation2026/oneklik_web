import { razorpay } from "./razorpay.js";

export interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
  method?: string;
  bank?: string;
  vpa?: string;
  card?: { network?: string; last4?: string };
  acquirer_data?: { rrn?: string; auth_code?: string };
  email?: string;
  contact?: string;
  fee?: number;
  tax?: number;
  amount?: number;
  currency?: string;
}

export function buildPaymentSnapshot(entity: RazorpayPaymentEntity): Record<string, unknown> {
  return {
    razorpay_payment_id: entity.id,
    order_id: entity.order_id,
    method: entity.method ?? null,
    bank: entity.bank ?? null,
    vpa: entity.vpa ?? null,
    card_network: entity.card?.network ?? null,
    card_last4: entity.card?.last4 ?? null,
    rrn: entity.acquirer_data?.rrn ?? null,
    auth_code: entity.acquirer_data?.auth_code ?? null,
    email: entity.email ?? null,
    contact: entity.contact ?? null,
    fee: entity.fee ?? null,
    tax: entity.tax ?? null,
    amount: entity.amount ?? null,
    currency: entity.currency ?? null,
  };
}

export async function enrichPaymentEntity(entity: RazorpayPaymentEntity): Promise<RazorpayPaymentEntity> {
  try {
    const fetched = (await razorpay.payments.fetch(entity.id)) as RazorpayPaymentEntity;
    return { ...entity, ...fetched, id: entity.id, order_id: entity.order_id };
  } catch {
    return entity;
  }
}

/** Build a payment snapshot for status-poll repair, fetching Razorpay when capture id is known. */
export async function buildRepairPaymentSnapshot(args: {
  gatewayCaptureId: string | null;
  gatewayOrderId: string | null;
}): Promise<Record<string, unknown>> {
  const captureId = args.gatewayCaptureId?.trim() || null;
  const orderId = args.gatewayOrderId?.trim() || null;

  if (captureId) {
    const enriched = await enrichPaymentEntity({
      id: captureId,
      order_id: orderId ?? "",
      status: "captured",
    });
    return {
      ...buildPaymentSnapshot(enriched),
      source: "status_poll_repair",
    };
  }

  return {
    order_id: orderId,
    razorpay_payment_id: null,
    method: null,
    source: "status_poll_repair",
  };
}
