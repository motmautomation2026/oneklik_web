import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { findPack } from "../lib/creditPacks.js";
import {
  AUTO_CLOSE_RESOLVED_AFTER_DAYS,
  AWAITING_REPLY_HOURS,
  ATTACHMENT_BUCKET,
  type MessageRole,
  type TicketCategory,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
} from "../support/types.js";
import type { AccountStatus } from "./types.js";

// Admin-side ticket access. Kept in its own module rather than appended to the
// already-long admin/queries.ts, but following the same conventions: service
// role throughout, bounded scans, emails resolved through GoTrue in deduped
// batches (profiles has no email column).

const TICKET_COLUMNS =
  "id, ticket_number, user_id, category, subject, status, priority, source, assigned_to, " +
  "account_status_at_submit, context_ref_type, context_ref_id, related_ticket_id, " +
  "created_at, updated_at, first_response_at, resolved_at, closed_at, " +
  "last_message_at, last_message_role, user_read_at, admin_read_at";

export interface AdminTicketRow {
  id: string;
  ticket_number: number;
  user_id: string;
  email: string | null;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  assigned_to: string | null;
  assigned_to_email: string | null;
  account_status_at_submit: AccountStatus;
  created_at: string;
  last_message_at: string;
  last_message_role: MessageRole;
  first_response_at: string | null;
  // Support has not replied to the customer's latest message.
  awaiting_reply: boolean;
  // Nobody on the team has opened it since the last customer message.
  admin_unread: boolean;
}

export interface AdminTicketMessage {
  id: string;
  author_id: string | null;
  author_role: MessageRole;
  author_email: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  attachments: { id: string; filename: string; mime: string; size_bytes: number }[];
}

export interface AdminTicketEvent {
  id: string;
  actor_role: string;
  actor_email: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
}

export interface AdminTicketDetail extends AdminTicketRow {
  related_ticket_id: string | null;
  context_ref_type: string | null;
  context_ref_id: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  // Live requester state, deliberately separate from account_status_at_submit
  // — an admin needs both "what they are now" and "what they were when they
  // wrote in".
  requester: {
    account_status: AccountStatus;
    suspended_until: string | null;
    status_reason: string | null;
    support_muted_until: string | null;
    company: string | null;
    available_balance: number;
    other_ticket_count: number;
    subscription: {
      plan_id: string;
      plan_name: string | null;
      status: string;
      current_period_end: string;
      grace_ends_at: string;
    } | null;
  };
  messages: AdminTicketMessage[];
  events: AdminTicketEvent[];
}

export interface SupportKpis {
  open: number;
  unassigned: number;
  awaiting_reply: number;
  resolved_this_week: number;
  median_first_response_minutes: number | null;
}

// ── email resolution ────────────────────────────────────────────────────
// profiles has no email column, so every display email comes from GoTrue. One
// lookup per DISTINCT id, not per row — the same de-duplication as
// resolveActorEmails in admin/queries.ts.
//
// Fine for a 25-row page. NOT fine for an export: see resolveEmailsBulk.
async function resolveEmails(ids: (string | null)[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const distinct = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  await Promise.all(
    distinct.map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      map.set(id, data.user?.email ?? null);
    }),
  );
  return map;
}

const GOTRUE_PAGE_SIZE = 1000;
const GOTRUE_MAX_PAGES = 20;

// Above this many distinct users, one sweep of the GoTrue user list is cheaper
// and far kinder to rate limits than a getUserById per user. 25 is roughly
// where the two cross over for a single admin page.
const BULK_EMAIL_THRESHOLD = 25;

// Export-safe email resolution. Firing hundreds of parallel getUserById calls
// (which is what the per-page helper above would do over an export-sized set)
// invites GoTrue rate limiting and socket exhaustion. Past a threshold this
// pages through the user list once instead — at most GOTRUE_MAX_PAGES requests
// no matter how many tickets are being exported.
async function resolveEmailsBulk(ids: (string | null)[]): Promise<Map<string, string | null>> {
  const distinct = new Set(ids.filter((id): id is string => Boolean(id)));
  if (distinct.size === 0) return new Map();
  if (distinct.size <= BULK_EMAIL_THRESHOLD) return resolveEmails([...distinct]);

  const map = new Map<string, string | null>();
  for (let page = 1; page <= GOTRUE_MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: GOTRUE_PAGE_SIZE });
    if (error) throw error;
    const users = "users" in data ? data.users : [];
    for (const user of users) {
      if (distinct.has(user.id)) map.set(user.id, user.email ?? null);
    }
    if (users.length < GOTRUE_PAGE_SIZE) break;
    if (map.size === distinct.size) break;
  }
  return map;
}

function awaitingReply(row: { last_message_role: MessageRole; status: TicketStatus }): boolean {
  return row.last_message_role === "user" && row.status !== "closed" && row.status !== "resolved";
}

function adminUnread(row: { last_message_role: MessageRole; last_message_at: string; admin_read_at: string | null }): boolean {
  if (row.last_message_role !== "user") return false;
  if (!row.admin_read_at) return true;
  return new Date(row.admin_read_at).getTime() < new Date(row.last_message_at).getTime();
}

// ── lazy auto-close ─────────────────────────────────────────────────────
// No scheduler exists in this project, so resolved tickets are closed on the
// way past, during admin reads. Bounded to 200 rows per call so a long-ignored
// backlog can never turn one page load into a mass update; the next read picks
// up where this one stopped.
async function autoCloseStaleResolved(): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_RESOLVED_AFTER_DAYS * 86400 * 1000).toISOString();

  const { data: stale, error } = await supabaseAdmin
    .from("support_tickets")
    .select("id")
    .eq("status", "resolved")
    .lt("resolved_at", cutoff)
    .limit(200);
  if (error || !stale || stale.length === 0) return;

  const ids = stale.map((row) => row.id as string);
  const now = new Date().toISOString();

  // Re-assert status = 'resolved' in the WHERE clause so a ticket a customer
  // reopened in the moment between the select and this update is not closed
  // out from under them.
  const { data: closed, error: updateError } = await supabaseAdmin
    .from("support_tickets")
    .update({ status: "closed", closed_at: now })
    .in("id", ids)
    .eq("status", "resolved")
    .select("id");
  if (updateError || !closed || closed.length === 0) return;

  await supabaseAdmin.from("support_events").insert(
    closed.map((row) => ({
      ticket_id: row.id as string,
      actor_role: "system",
      event_type: "auto_closed",
      from_value: "resolved",
      to_value: "closed",
      note: `Closed automatically after ${AUTO_CLOSE_RESOLVED_AFTER_DAYS} days with no reply`,
    })),
  );
}

// ── list ────────────────────────────────────────────────────────────────

export interface GetSupportTicketsParams {
  page: number;
  pageSize: number;
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assignedTo?: string;
  unassignedOnly?: boolean;
  unansweredOnly?: boolean;
  openOnly?: boolean;
  search?: string;
}

function applyFilters(query: any, params: GetSupportTicketsParams): any {
  let q = query;
  if (params.status) q = q.eq("status", params.status);
  // "Open" must mean the same thing in all three places it is surfaced: this
  // default queue view, the Open KPI tile, and the sidebar badge. Excluding
  // 'resolved' as well as 'closed' is what makes them agree — otherwise the
  // tile reports 3 while the list beneath it shows 5, because resolved tickets
  // slipped through. Resolved stays reachable via the status dropdown.
  else if (params.openOnly) q = q.not("status", "in", "(closed,resolved)");
  if (params.category) q = q.eq("category", params.category);
  if (params.priority) q = q.eq("priority", params.priority);
  if (params.assignedTo) q = q.eq("assigned_to", params.assignedTo);
  if (params.unassignedOnly) q = q.is("assigned_to", null);
  // "Unanswered" is the customer having the last word — the queue's real
  // working set.
  if (params.unansweredOnly) q = q.eq("last_message_role", "user");
  return q;
}

// Subject search only. Searching message bodies would need full-text indexing
// that 0008 does not create, and searching by requester email would mean a
// bounded GoTrue scan per keystroke; the admin can reach a user's tickets from
// their detail page instead.
function applySearch(query: any, search?: string): any {
  if (!search) return query;
  const term = search.trim();
  if (!term) return query;
  const numeric = Number(term.replace(/^#/, ""));
  if (Number.isInteger(numeric) && numeric > 0) return query.eq("ticket_number", numeric);
  return query.ilike("subject", `%${term}%`);
}

export async function getSupportTickets(params: GetSupportTicketsParams): Promise<{
  rows: AdminTicketRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  await autoCloseStaleResolved();

  const from = (params.page - 1) * params.pageSize;
  let query = supabaseAdmin.from("support_tickets").select(TICKET_COLUMNS, { count: "exact" });
  query = applySearch(applyFilters(query, params), params.search);

  const { data, error, count } = await query
    .order("last_message_at", { ascending: false })
    .range(from, from + params.pageSize - 1);
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const emails = await resolveEmails([...rows.map((r) => r.user_id), ...rows.map((r) => r.assigned_to)]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      ticket_number: row.ticket_number,
      user_id: row.user_id,
      email: emails.get(row.user_id) ?? null,
      category: row.category,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      source: row.source,
      assigned_to: row.assigned_to,
      assigned_to_email: row.assigned_to ? emails.get(row.assigned_to) ?? null : null,
      account_status_at_submit: row.account_status_at_submit,
      created_at: row.created_at,
      last_message_at: row.last_message_at,
      last_message_role: row.last_message_role,
      first_response_at: row.first_response_at,
      awaiting_reply: awaitingReply(row),
      admin_unread: adminUnread(row),
    })),
    total: count ?? 0,
    page: params.page,
    page_size: params.pageSize,
  };
}

const EXPORT_PAGE_SIZE = 1000;
export const MAX_EXPORT_ROWS = 10_000;

export class ExportTooLargeError extends Error {
  constructor(public readonly total: number) {
    super(`Export would contain ${total} tickets, above the ${MAX_EXPORT_ROWS} row limit`);
    this.name = "ExportTooLargeError";
  }
}

// Paginates properly rather than taking the first page and calling it the
// answer. The previous version asked for a single 1000-row page, so an export
// of 1500 tickets silently produced a 1000-row file with no indication that
// 500 were missing — an admin would reasonably have believed it complete.
//
// Past MAX_EXPORT_ROWS this refuses outright instead of truncating. Handing
// back a file that quietly omits rows is worse than asking for narrower
// filters, because nothing about the file reveals the omission.
export async function getSupportTicketsForExport(
  params: Omit<GetSupportTicketsParams, "page" | "pageSize">,
): Promise<AdminTicketRow[]> {
  await autoCloseStaleResolved();

  const countQuery = applySearch(
    applyFilters(supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }), {
      ...params,
      page: 1,
      pageSize: 1,
    }),
    params.search,
  );
  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  if ((count ?? 0) > MAX_EXPORT_ROWS) throw new ExportTooLargeError(count ?? 0);

  const rows: any[] = [];
  for (let page = 0; page * EXPORT_PAGE_SIZE < (count ?? 0); page++) {
    const from = page * EXPORT_PAGE_SIZE;
    const query = applySearch(
      applyFilters(supabaseAdmin.from("support_tickets").select(TICKET_COLUMNS), {
        ...params,
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
      }),
      params.search,
    );
    // Ordered by created_at, not last_message_at: an export must have a stable
    // sort key, and last_message_at can change mid-export as customers reply,
    // which would shuffle rows between pages and duplicate or skip them.
    const { data, error } = await query.order("created_at", { ascending: false }).range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
  }

  const emails = await resolveEmailsBulk([...rows.map((r) => r.user_id), ...rows.map((r) => r.assigned_to)]);

  return rows.map((row) => ({
    id: row.id,
    ticket_number: row.ticket_number,
    user_id: row.user_id,
    email: emails.get(row.user_id) ?? null,
    category: row.category,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    source: row.source,
    assigned_to: row.assigned_to,
    assigned_to_email: row.assigned_to ? emails.get(row.assigned_to) ?? null : null,
    account_status_at_submit: row.account_status_at_submit,
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    last_message_role: row.last_message_role,
    first_response_at: row.first_response_at,
    awaiting_reply: awaitingReply(row),
    admin_unread: adminUnread(row),
  }));
}

// ── KPIs ────────────────────────────────────────────────────────────────

async function countWhere(build: (q: any) => any): Promise<number> {
  const { count, error } = await build(
    supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }),
  );
  if (error) throw error;
  return count ?? 0;
}

export async function getSupportKpis(): Promise<SupportKpis> {
  await autoCloseStaleResolved();

  const awaitingCutoff = new Date(Date.now() - AWAITING_REPLY_HOURS * 3600 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

  const [open, unassigned, awaiting, resolvedThisWeek] = await Promise.all([
    countWhere((q) => q.neq("status", "closed").neq("status", "resolved")),
    countWhere((q) => q.is("assigned_to", null).neq("status", "closed").neq("status", "resolved")),
    countWhere((q) =>
      q.eq("last_message_role", "user").neq("status", "closed").neq("status", "resolved").lt("last_message_at", awaitingCutoff),
    ),
    countWhere((q) => q.gte("resolved_at", weekAgo)),
  ]);

  // Median rather than mean: one ticket answered three weeks late would drag a
  // mean far enough to make the number meaningless.
  const { data: responded, error } = await supabaseAdmin
    .from("support_tickets")
    .select("created_at, first_response_at")
    .not("first_response_at", "is", null)
    .gte("created_at", monthAgo)
    .limit(500);
  if (error) throw error;

  let median: number | null = null;
  const deltas = (responded ?? [])
    .map((row) => new Date(row.first_response_at as string).getTime() - new Date(row.created_at as string).getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  if (deltas.length > 0) {
    const mid = Math.floor(deltas.length / 2);
    const ms = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
    median = Math.round(ms / 60000);
  }

  return {
    open,
    unassigned,
    awaiting_reply: awaiting,
    resolved_this_week: resolvedThisWeek,
    median_first_response_minutes: median,
  };
}

// Drives the sidebar badge. Same definition as the "unassigned/unanswered"
// working set so the badge and the queue never disagree.
export async function getSupportBadgeCount(): Promise<number> {
  return countWhere((q) => q.eq("last_message_role", "user").neq("status", "closed").neq("status", "resolved"));
}

// ── detail ──────────────────────────────────────────────────────────────

export async function getSupportTicketDetail(ticketId: string): Promise<AdminTicketDetail | null> {
  const { data, error } = await supabaseAdmin
    .from("support_tickets")
    .select(TICKET_COLUMNS)
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as any;

  const [{ data: profile }, { data: wallet }, { count: otherTickets }, { data: messages }, { data: attachments }, { data: events }, { data: subscription }] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("account_status, suspended_until, status_reason, support_muted_until, company")
        .eq("id", row.user_id)
        .maybeSingle(),
      supabaseAdmin.from("credit_wallets").select("available_balance").eq("user_id", row.user_id).maybeSingle(),
      supabaseAdmin
        .from("support_tickets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .neq("id", ticketId),
      supabaseAdmin
        .from("support_messages")
        .select("id, author_id, author_role, body, is_internal, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("support_attachments")
        .select("id, message_id, filename, mime, size_bytes")
        .eq("ticket_id", ticketId),
      supabaseAdmin
        .from("support_events")
        .select("id, actor_id, actor_role, event_type, from_value, to_value, note, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("subscriptions")
        .select("plan_id, status, current_period_end, grace_ends_at")
        .eq("user_id", row.user_id)
        .maybeSingle(),
    ]);

  const messageRows = (messages ?? []) as any[];
  const eventRows = (events ?? []) as any[];
  const emails = await resolveEmails([
    row.user_id,
    row.assigned_to,
    ...messageRows.map((m) => m.author_id),
    ...eventRows.map((e) => e.actor_id),
  ]);

  const byMessage = new Map<string, AdminTicketDetail["messages"][number]["attachments"]>();
  for (const a of (attachments ?? []) as any[]) {
    if (!a.message_id) continue;
    const list = byMessage.get(a.message_id) ?? [];
    list.push({ id: a.id, filename: a.filename, mime: a.mime, size_bytes: a.size_bytes });
    byMessage.set(a.message_id, list);
  }

  return {
    id: row.id,
    ticket_number: row.ticket_number,
    user_id: row.user_id,
    email: emails.get(row.user_id) ?? null,
    category: row.category,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    source: row.source,
    assigned_to: row.assigned_to,
    assigned_to_email: row.assigned_to ? emails.get(row.assigned_to) ?? null : null,
    account_status_at_submit: row.account_status_at_submit,
    context_ref_type: row.context_ref_type,
    context_ref_id: row.context_ref_id,
    related_ticket_id: row.related_ticket_id,
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    last_message_role: row.last_message_role,
    first_response_at: row.first_response_at,
    resolved_at: row.resolved_at,
    closed_at: row.closed_at,
    awaiting_reply: awaitingReply(row),
    admin_unread: adminUnread(row),
    requester: {
      account_status: (profile?.account_status ?? "active") as AccountStatus,
      suspended_until: profile?.suspended_until ?? null,
      status_reason: profile?.status_reason ?? null,
      support_muted_until: profile?.support_muted_until ?? null,
      company: profile?.company ?? null,
      available_balance: wallet?.available_balance ?? 0,
      other_ticket_count: otherTickets ?? 0,
      subscription: subscription
        ? {
            plan_id: subscription.plan_id as string,
            plan_name: findPack(subscription.plan_id as string)?.name ?? null,
            status: subscription.status as string,
            current_period_end: subscription.current_period_end as string,
            grace_ends_at: subscription.grace_ends_at as string,
          }
        : null,
    },
    messages: messageRows.map((m) => ({
      id: m.id,
      author_id: m.author_id,
      author_role: m.author_role,
      author_email: m.author_id ? emails.get(m.author_id) ?? null : null,
      body: m.body,
      is_internal: m.is_internal,
      created_at: m.created_at,
      attachments: byMessage.get(m.id) ?? [],
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      actor_role: e.actor_role,
      actor_email: e.actor_id ? emails.get(e.actor_id) ?? null : null,
      event_type: e.event_type,
      from_value: e.from_value,
      to_value: e.to_value,
      note: e.note,
      created_at: e.created_at,
    })),
  };
}

// ── writes ──────────────────────────────────────────────────────────────

export async function addAdminMessage(params: {
  ticketId: string;
  adminId: string;
  body: string;
  isInternal: boolean;
}): Promise<boolean> {
  const { data: ticket, error } = await supabaseAdmin
    .from("support_tickets")
    .select("id, status")
    .eq("id", params.ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!ticket) return false;

  const now = new Date().toISOString();

  const { error: messageError } = await supabaseAdmin.from("support_messages").insert({
    ticket_id: params.ticketId,
    author_id: params.adminId,
    author_role: "admin",
    body: params.body,
    is_internal: params.isInternal,
  });
  if (messageError) throw messageError;

  // An internal note is not a response: it must not move the ticket into
  // waiting_on_user, must not touch last_message_* (which drives the
  // customer's unread dot), and must not stop the first-response clock.
  if (params.isInternal) {
    await supabaseAdmin.from("support_tickets").update({ admin_read_at: now }).eq("id", params.ticketId);
    return true;
  }

  const patch: Record<string, unknown> = {
    last_message_at: now,
    last_message_role: "admin",
    admin_read_at: now,
  };
  if (ticket.status === "open" || ticket.status === "in_progress") patch.status = "waiting_on_user";

  const { error: patchError } = await supabaseAdmin.from("support_tickets").update(patch).eq("id", params.ticketId);
  if (patchError) throw patchError;

  // Conditional on first_response_at still being null, so two admins replying
  // at once cannot overwrite the real first-response time with a later one.
  await supabaseAdmin
    .from("support_tickets")
    .update({ first_response_at: now })
    .eq("id", params.ticketId)
    .is("first_response_at", null);

  return true;
}

const TERMINAL: TicketStatus[] = ["resolved", "closed"];

export async function updateSupportTicket(params: {
  ticketId: string;
  adminId: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  // undefined = leave alone, null = unassign.
  assignedTo?: string | null;
}): Promise<boolean> {
  const { data: current, error } = await supabaseAdmin
    .from("support_tickets")
    .select("status, priority, assigned_to")
    .eq("id", params.ticketId)
    .maybeSingle();
  if (error) throw error;
  if (!current) return false;

  const patch: Record<string, unknown> = {};
  const events: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  if (params.status && params.status !== current.status) {
    patch.status = params.status;
    // Keep resolved_at/closed_at consistent with the two CHECK constraints in
    // 0008 — leaving a stale resolved_at behind is a constraint violation, not
    // merely untidy data.
    if (params.status === "resolved") {
      patch.resolved_at = now;
      patch.closed_at = null;
    } else if (params.status === "closed") {
      patch.closed_at = now;
    } else {
      patch.resolved_at = null;
      patch.closed_at = null;
    }
    events.push({
      ticket_id: params.ticketId,
      actor_id: params.adminId,
      actor_role: "admin",
      event_type: TERMINAL.includes(params.status) ? "status_changed" : current.status === "closed" ? "reopened" : "status_changed",
      from_value: current.status,
      to_value: params.status,
    });
  }

  if (params.priority && params.priority !== current.priority) {
    patch.priority = params.priority;
    events.push({
      ticket_id: params.ticketId,
      actor_id: params.adminId,
      actor_role: "admin",
      event_type: "priority_changed",
      from_value: current.priority,
      to_value: params.priority,
    });
  }

  if (params.assignedTo !== undefined && params.assignedTo !== current.assigned_to) {
    patch.assigned_to = params.assignedTo;
    events.push({
      ticket_id: params.ticketId,
      actor_id: params.adminId,
      actor_role: "admin",
      event_type: params.assignedTo ? "assigned" : "unassigned",
      from_value: current.assigned_to,
      to_value: params.assignedTo,
    });
  }

  if (Object.keys(patch).length === 0) return true;

  const { error: patchError } = await supabaseAdmin.from("support_tickets").update(patch).eq("id", params.ticketId);
  if (patchError) throw patchError;

  if (events.length > 0) await supabaseAdmin.from("support_events").insert(events);
  return true;
}

export async function markTicketReadByAdmin(ticketId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("support_tickets")
    .update({ admin_read_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (error) throw error;
}

// The escape valve for a requester who will not stop. Deliberately time-boxed
// rather than permanent, and recorded against the ticket that prompted it so
// the decision is auditable. Guarded against muting an admin.
export async function setSupportMute(params: {
  ticketId: string;
  userId: string;
  adminId: string;
  until: string | null;
}): Promise<boolean> {
  const { data: target, error } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", params.userId)
    .maybeSingle();
  if (error) throw error;
  if (!target) return false;
  if (target.is_admin) return false;

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ support_muted_until: params.until })
    .eq("id", params.userId);
  if (updateError) throw updateError;

  await supabaseAdmin.from("support_events").insert({
    ticket_id: params.ticketId,
    actor_id: params.adminId,
    actor_role: "admin",
    event_type: "muted",
    to_value: params.until,
    note: params.until ? `Support muted until ${params.until}` : "Support mute lifted",
  });
  return true;
}

export async function getAdminAttachmentUrl(attachmentId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("support_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(data.storage_path as string, 60);
  if (signError) throw signError;
  return signed?.signedUrl ?? null;
}
