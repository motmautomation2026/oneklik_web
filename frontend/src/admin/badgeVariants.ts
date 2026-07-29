// react-bootstrap Badge `bg` values for status-ish enum fields — shared
// between AdminTransactionsPage and AdminUserDetailPage so the same status
// always reads as the same color across both.

export const PAYMENT_STATUS_VARIANT: Record<string, string> = {
  success: "success",
  pending: "warning",
  initiated: "secondary",
  failed: "danger",
};

export const FLAGGED_STATUS_VARIANT: Record<string, string> = {
  open: "danger",
  reviewed: "success",
  dismissed: "secondary",
};

export const ACCOUNT_STATUS_VARIANT: Record<string, string> = {
  active: "success",
  frozen: "info",
  suspended: "warning",
  banned: "danger",
};

// Support ticket status. 'waiting_on_user' is deliberately muted — the ball is
// in the customer's court, so it should not compete for attention with the
// states the team still owns.
export const TICKET_STATUS_VARIANT: Record<string, string> = {
  open: "danger",
  in_progress: "primary",
  waiting_on_user: "secondary",
  resolved: "success",
  closed: "dark",
};

export const TICKET_PRIORITY_VARIANT: Record<string, string> = {
  low: "secondary",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

export const LEDGER_TYPE_VARIANT: Record<string, string> = {
  purchase: "success",
  promo_grant: "success",
  deduct: "secondary",
  hold: "warning",
  release: "info",
  admin_adjustment: "primary",
};

export const SUBSCRIPTION_STATUS_VARIANT: Record<string, string> = {
  active: "success",
  past_due: "warning",
  expired: "danger",
  cancelled: "secondary",
};

export const INVOICE_STATUS_VARIANT: Record<string, string> = {
  paid: "success",
  issued: "warning",
  cancelled: "secondary",
  void: "dark",
};

export const INVOICE_DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice: "Tax invoice",
  proforma_invoice: "Pro forma",
  credit_note: "Credit note",
};
