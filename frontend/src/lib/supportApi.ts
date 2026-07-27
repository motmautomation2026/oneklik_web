import { apiGet, apiPost } from "./api";
import { supabase } from "./supabaseClient";

// User-facing support client. Ticket data always goes through the backend
// (never straight to Postgres via RLS) because internal admin notes live in the
// same table as customer messages — the server is the only thing that decides
// which messages a customer may see.
//
// Attachment *bytes* are the exception: those upload directly to Supabase
// Storage, which is a private bucket with its own RLS scoping writes to the
// caller's own folder. The backend then validates and records the paths.

export type TicketStatus = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type TicketMessageRole = "user" | "admin" | "system";
export type TicketCategory =
  | "billing"
  | "credits"
  | "data_quality"
  | "account_access"
  | "bug"
  | "feature_request"
  | "other";

export const SUPPORT_CATEGORIES: { value: TicketCategory; label: string; hint: string }[] = [
  { value: "account_access", label: "Account access & appeals", hint: "Locked out, restricted, or can't sign in" },
  { value: "billing", label: "Billing & payments", hint: "Receipts, failed payments, billing questions" },
  { value: "credits", label: "Credits & refunds", hint: "Credits missing, charged incorrectly" },
  { value: "data_quality", label: "Data quality", hint: "A revealed email or phone number was wrong" },
  { value: "bug", label: "Something is broken", hint: "An error or unexpected behaviour" },
  { value: "feature_request", label: "Feature request", hint: "Something you'd like us to add" },
  { value: "other", label: "Something else", hint: "Anything not covered above" },
];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_user: "Waiting on you",
  resolved: "Resolved",
  closed: "Closed",
};

// react-bootstrap Badge variants. 'waiting_on_user' is the one the customer
// must act on, so it is the one that stands out on their side — the mirror of
// the admin palette, where that state is deliberately muted.
export const TICKET_STATUS_VARIANT: Record<TicketStatus, string> = {
  open: "primary",
  in_progress: "info",
  waiting_on_user: "warning",
  resolved: "success",
  closed: "secondary",
};

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const ATTACHMENT_BUCKET = "support-attachments";

export interface TicketAttachment {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
}

export interface TicketMessage {
  id: string;
  author_role: TicketMessageRole;
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
  priority: string;
  source: string;
  created_at: string;
  last_message_at: string;
  last_message_role: TicketMessageRole;
  has_unread: boolean;
}

export interface TicketDetail extends TicketSummary {
  related_ticket_id: string | null;
  messages: TicketMessage[];
}

export function fetchMyTickets(
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
): Promise<{ rows: TicketSummary[]; total: number; page: number; page_size: number }> {
  return apiGet(`/api/support/tickets?page=${page}&pageSize=${pageSize}`, signal);
}

export function fetchMyTicket(id: string, signal?: AbortSignal): Promise<{ ticket: TicketDetail }> {
  return apiGet(`/api/support/tickets/${id}`, signal);
}

export function fetchUnreadCount(signal?: AbortSignal): Promise<{ unread: number }> {
  return apiGet("/api/support/tickets/unread-count", signal);
}

export function createTicket(input: {
  category: TicketCategory;
  subject: string;
  body: string;
  source: "app" | "lockout";
  attachment_paths: string[];
  related_ticket_id?: string | null;
}): Promise<{ ticket: TicketDetail; appended: boolean }> {
  return apiPost("/api/support/tickets", input);
}

export function replyToTicket(
  id: string,
  body: string,
  attachmentPaths: string[],
): Promise<{ ticket: TicketDetail; reopened: boolean }> {
  return apiPost(`/api/support/tickets/${id}/messages`, { body, attachment_paths: attachmentPaths });
}

export function markTicketRead(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/support/tickets/${id}/read`, {});
}

export function fetchAttachmentUrl(attachmentId: string): Promise<{ url: string }> {
  return apiGet(`/api/support/attachments/${attachmentId}/url`);
}

// Strips anything that could confuse a path or a download header. The result
// is only ever a display name — the storage key's uniqueness comes from the
// uuid folder, not from this.
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").slice(-120);
  return cleaned || "attachment";
}

export function validateFile(file: File): string | null {
  if (!ALLOWED_ATTACHMENT_MIMES.includes(file.type)) {
    return `${file.name}: only PNG, JPEG, WEBP and PDF files can be attached.`;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name}: files must be 5 MB or smaller.`;
  }
  if (file.size === 0) return `${file.name}: file is empty.`;
  return null;
}

// Uploads to `<userId>/<uuid>/<filename>`. The nested uuid folder is what makes
// the key unique, which lets the last path segment stay the human filename —
// so an admin sees "screenshot.png", not a uuid. Storage RLS keys on the FIRST
// path segment, so this nesting does not weaken the ownership check.
export async function uploadAttachment(userId: string, file: File): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}/${safeFilename(file.name)}`;
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
  return path;
}
