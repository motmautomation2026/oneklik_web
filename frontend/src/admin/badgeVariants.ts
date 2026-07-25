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

export const LEDGER_TYPE_VARIANT: Record<string, string> = {
  purchase: "success",
  promo_grant: "success",
  deduct: "secondary",
  hold: "warning",
  release: "info",
  admin_adjustment: "primary",
};
