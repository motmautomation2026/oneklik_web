// Shared support-ticket vocabulary. Values must stay in lockstep with the
// CHECK constraints in supabase/migrations/0008_support_tickets.sql — the
// database is the authority, these are the compile-time mirror of it.

export type TicketStatus = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketSource = "app" | "lockout" | "admin";
export type MessageRole = "user" | "admin" | "system";

export type TicketCategory =
  | "billing"
  | "credits"
  | "data_quality"
  | "account_access"
  | "bug"
  | "feature_request"
  | "other";

export const TICKET_CATEGORIES: TicketCategory[] = [
  "billing",
  "credits",
  "data_quality",
  "account_access",
  "bug",
  "feature_request",
  "other",
];

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_user",
  "resolved",
  "closed",
];

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

// Statuses that still count against a user's open-ticket allowance. 'resolved'
// is included deliberately: a resolved ticket can be reopened by replying, so
// treating it as free allowance would let a user accumulate an unbounded number
// of reopenable threads.
export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "waiting_on_user", "resolved"];

// ── limits ──────────────────────────────────────────────────────────────
// Deliberately modest. Every requester is authenticated, so abuse is
// attributable and rare; these exist to bound a runaway client or a single
// angry user, not to fend off anonymous spam.

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;

// A locked-out user gets exactly one thread. They have one thing to say — "I
// think this is a mistake" — and letting a banned account open ten parallel
// appeals is how the queue gets buried.
export const MAX_OPEN_TICKETS_LOCKED_OUT = 1;
export const MAX_OPEN_TICKETS_DEFAULT = 3;

export const MIN_SECONDS_BETWEEN_TICKETS = 60;

// Per ticket, not per user — deliberately. Counting a user's messages globally
// would need an index on support_messages(author_id, created_at) that does not
// exist; counting within one thread rides the (ticket_id, created_at) index
// that does. It is also the more meaningful limit, since flooding happens in a
// thread. The open-ticket cap bounds the global rate as a side effect.
export const MAX_MESSAGES_PER_TICKET_PER_HOUR = 20;

// A resolved ticket reopens on reply within this window; past it, replying
// starts a new ticket linked back via related_ticket_id.
export const REOPEN_WINDOW_DAYS = 14;

// Resolved tickets close themselves after this long without a reply. There is
// no scheduler in this project, so it happens lazily on admin reads — the same
// approach the suspension expiry already uses. Deliberately shorter than
// REOPEN_WINDOW_DAYS: a resolved ticket auto-closes at 7 days, but the user can
// still reopen it by replying up to 14, so the auto-close is housekeeping for
// the queue rather than a door slamming on the customer.
export const AUTO_CLOSE_RESOLVED_AFTER_DAYS = 7;

// A ticket whose last word came from the user this long ago is "awaiting
// reply" on the support KPI tile.
export const AWAITING_REPLY_HOURS = 24;

export const ATTACHMENT_BUCKET = "support-attachments";
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

// Orphaned uploads (picked in the composer, never submitted) are swept after
// this long. Generous enough that a slow submission is never eaten.
export const ORPHAN_ATTACHMENT_TTL_HOURS = 24;

export const SIGNED_URL_TTL_SECONDS = 60;

// ── wire shapes ─────────────────────────────────────────────────────────

export interface TicketAttachment {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
}

export interface TicketMessage {
  id: string;
  author_role: MessageRole;
  body: string;
  created_at: string;
  attachments: TicketAttachment[];
}

export interface TicketSummary {
  id: string;
  ticket_number: number;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  created_at: string;
  last_message_at: string;
  last_message_role: MessageRole;
  // True when support replied more recently than the user last opened the
  // thread. Computed server-side so the unread dot can never disagree between
  // the topbar badge and the ticket list.
  has_unread: boolean;
}

export interface TicketDetail extends TicketSummary {
  related_ticket_id: string | null;
  messages: TicketMessage[];
}

export type CreateTicketResult =
  | { ok: true; ticket: TicketDetail; appended: boolean }
  | { ok: false; reason: "muted"; until: string | null }
  | { ok: false; reason: "rate_limited"; retry_after_seconds: number }
  | { ok: false; reason: "invalid_attachment"; detail: string };

export type ReplyResult =
  | { ok: true; ticket: TicketDetail; reopened: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "closed" }
  | { ok: false; reason: "muted"; until: string | null }
  | { ok: false; reason: "rate_limited"; retry_after_seconds: number }
  | { ok: false; reason: "invalid_attachment"; detail: string };
