import { createHash } from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  ACTIVE_TICKET_STATUSES,
  ALLOWED_ATTACHMENT_MIMES,
  ATTACHMENT_BUCKET,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGES_PER_TICKET_PER_HOUR,
  MAX_OPEN_TICKETS_DEFAULT,
  MAX_OPEN_TICKETS_LOCKED_OUT,
  MIN_SECONDS_BETWEEN_TICKETS,
  ORPHAN_ATTACHMENT_TTL_HOURS,
  REOPEN_WINDOW_DAYS,
  SIGNED_URL_TTL_SECONDS,
  type CreateTicketResult,
  type ReplyResult,
  type TicketAttachment,
  type TicketCategory,
  type TicketDetail,
  type TicketMessage,
  type TicketSource,
  type TicketSummary,
} from "./types.js";

// Every function here runs on the service role and is therefore responsible
// for its own ownership checks — RLS is not doing it for us. The rule is
// simple and absolute: any function that takes a userId filters by it, and any
// function that can be called by an admin takes an explicit isAdmin flag
// rather than inferring trust from the absence of a userId.
//
// The reason this whole module exists (rather than letting the frontend read
// tickets through RLS like it reads wallets) is support_messages.is_internal.
// Exactly one query below selects messages for a non-admin, and it hard-codes
// is_internal = false. A leaked internal note is unrecoverable, so the number
// of places that could leak one is kept at one.

const TICKET_COLUMNS =
  "id, ticket_number, user_id, category, subject, status, priority, source, created_at, last_message_at, last_message_role, user_read_at, related_ticket_id";

interface TicketRow {
  id: string;
  ticket_number: number;
  user_id: string;
  category: TicketCategory;
  subject: string;
  status: TicketSummary["status"];
  priority: TicketSummary["priority"];
  source: TicketSource;
  created_at: string;
  last_message_at: string;
  last_message_role: TicketSummary["last_message_role"];
  user_read_at: string | null;
  related_ticket_id: string | null;
}

// Support replied more recently than the user last opened the thread. Computed
// here, once, so the topbar dot and the ticket list can never disagree.
function hasUnread(row: TicketRow): boolean {
  if (row.last_message_role !== "admin") return false;
  if (!row.user_read_at) return true;
  return new Date(row.user_read_at).getTime() < new Date(row.last_message_at).getTime();
}

function toSummary(row: TicketRow): TicketSummary {
  return {
    id: row.id,
    ticket_number: row.ticket_number,
    category: row.category,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    source: row.source,
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    last_message_role: row.last_message_role,
    has_unread: hasUnread(row),
  };
}

export interface RequesterContext {
  account_status: "active" | "frozen" | "suspended" | "banned";
  suspended_until: string | null;
  support_muted_until: string | null;
}

export async function getRequesterContext(userId: string): Promise<RequesterContext | null> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("account_status, suspended_until, support_muted_until")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as RequesterContext;
}

// Mirrors isLockedOut() in the frontend and enforceAccountStatus in the
// backend: banned always, suspended only while the deadline has not passed.
function isLockedOut(ctx: RequesterContext): boolean {
  if (ctx.account_status === "banned") return true;
  if (ctx.account_status !== "suspended") return false;
  if (!ctx.suspended_until) return true;
  return new Date(ctx.suspended_until).getTime() > Date.now();
}

function isMuted(ctx: RequesterContext): boolean {
  return ctx.support_muted_until !== null && new Date(ctx.support_muted_until).getTime() > Date.now();
}

function dedupeHash(category: string, subject: string, body: string): string {
  return createHash("sha256").update(`${category}\n${subject.trim()}\n${body.trim()}`).digest("hex");
}

// ── attachments ─────────────────────────────────────────────────────────

interface ValidatedAttachment {
  storage_path: string;
  filename: string;
  mime: string;
  size_bytes: number;
}

type AttachmentValidation =
  | { ok: true; attachments: ValidatedAttachment[] }
  | { ok: false; detail: string };

// Validates paths the client claims to have uploaded. The security-critical
// check is the first one: the path must sit inside the caller's own folder.
// Without it, a user could attach someone else's file by guessing a path — the
// storage RLS policy stops them *uploading* outside their folder, but says
// nothing about which paths they may reference.
//
// Size and MIME are re-checked even though the bucket enforces both, because
// bucket config is a deployment artifact that can drift and this is cheap.
async function validateAttachments(userId: string, paths: string[]): Promise<AttachmentValidation> {
  if (paths.length === 0) return { ok: true, attachments: [] };
  if (paths.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, detail: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files can be attached to one message` };
  }

  const unique = [...new Set(paths)];
  const validated: ValidatedAttachment[] = [];

  for (const path of unique) {
    if (!path.startsWith(`${userId}/`) || path.includes("..")) {
      return { ok: false, detail: "Attachment path is not yours" };
    }

    const slash = path.lastIndexOf("/");
    const objectName = path.slice(slash + 1);

    // supabase-js has no stat(); list() with an exact search is the closest
    // thing and returns the metadata we need to re-validate.
    const { data, error } = await supabaseAdmin.storage
      .from(ATTACHMENT_BUCKET)
      .list(path.slice(0, slash), { search: objectName, limit: 100 });
    if (error) throw error;

    const object = (data ?? []).find((entry) => entry.name === objectName);
    if (!object) return { ok: false, detail: "Attachment was not found — try uploading it again" };

    const size = Number(object.metadata?.size ?? 0);
    const mime = String(object.metadata?.mimetype ?? "");

    if (!ALLOWED_ATTACHMENT_MIMES.includes(mime)) {
      return { ok: false, detail: `Unsupported file type: ${mime || "unknown"}` };
    }
    if (size <= 0 || size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, detail: "Attachment is larger than the 5 MB limit" };
    }

    validated.push({ storage_path: path, filename: objectName, mime, size_bytes: size });
  }

  return { ok: true, attachments: validated };
}

async function insertAttachments(
  ticketId: string,
  messageId: string,
  userId: string,
  attachments: ValidatedAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  const { error } = await supabaseAdmin.from("support_attachments").insert(
    attachments.map((a) => ({
      ticket_id: ticketId,
      message_id: messageId,
      uploaded_by: userId,
      storage_path: a.storage_path,
      filename: a.filename,
      mime: a.mime,
      size_bytes: a.size_bytes,
      is_internal: false,
    })),
  );
  if (error) throw error;
}

// How many candidate folders one sweep will inspect. The sweep runs
// fire-and-forget after each submit, so it does not need to finish in one go —
// a backlog drains over subsequent submissions.
const ORPHAN_SWEEP_FOLDER_LIMIT = 25;

// Deletes uploads that were selected in a composer but never submitted.
//
// Uploads live at `<userId>/<uuid>/<filename>`, so listing `<userId>` returns
// FOLDER PLACEHOLDERS, not objects: `{ name: "<uuid>", id: null,
// created_at: null }`. An earlier version filtered those on `created_at` and
// therefore discarded every entry and swept nothing — the function looked
// correct and did nothing. Timestamps only exist one level down, so the real
// objects have to be listed per folder.
//
// To keep that affordable, folders already referenced by support_attachments
// are skipped without a list call — those are linked by definition and can
// never be orphans. Only unreferenced folders (the actual candidates) cost a
// round trip, and at most ORPHAN_SWEEP_FOLDER_LIMIT of them per sweep.
export async function sweepOrphanAttachments(userId: string): Promise<void> {
  const { data: folders, error } = await supabaseAdmin.storage
    .from(ATTACHMENT_BUCKET)
    .list(userId, { limit: 100 });
  if (error || !folders || folders.length === 0) return;

  const { data: linked, error: linkedError } = await supabaseAdmin
    .from("support_attachments")
    .select("storage_path")
    .like("storage_path", `${userId}/%`);
  if (linkedError) return;

  // `<userId>/<uuid>/<file>` -> `<uuid>`
  const linkedFolders = new Set(
    (linked ?? [])
      .map((row) => (row.storage_path as string).split("/")[1])
      .filter((segment): segment is string => Boolean(segment)),
  );

  const candidates = folders
    .filter((entry) => entry.name && !linkedFolders.has(entry.name))
    .slice(0, ORPHAN_SWEEP_FOLDER_LIMIT);
  if (candidates.length === 0) return;

  const cutoff = Date.now() - ORPHAN_ATTACHMENT_TTL_HOURS * 3600 * 1000;
  const orphans: string[] = [];

  for (const folder of candidates) {
    const prefix = `${userId}/${folder.name}`;
    const { data: objects, error: listError } = await supabaseAdmin.storage
      .from(ATTACHMENT_BUCKET)
      .list(prefix, { limit: 20 });
    if (listError || !objects) continue;

    for (const object of objects) {
      // No timestamp means we cannot prove it is old, so leave it alone — the
      // failure mode of deleting a file a user is midway through attaching is
      // far worse than keeping a few stray bytes.
      if (!object.created_at) continue;
      if (new Date(object.created_at).getTime() >= cutoff) continue;
      orphans.push(`${prefix}/${object.name}`);
    }
  }

  if (orphans.length === 0) return;
  await supabaseAdmin.storage.from(ATTACHMENT_BUCKET).remove(orphans);
}

// Signed URL for one attachment. Ownership is re-derived from the parent
// ticket rather than trusted from the caller, and a non-admin can never reach
// an internal attachment.
export async function getAttachmentUrl(
  attachmentId: string,
  viewer: { userId: string; isAdmin: boolean },
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("support_attachments")
    .select("storage_path, is_internal, ticket_id, support_tickets!inner(user_id)")
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ownerId = (data.support_tickets as unknown as { user_id: string }).user_id;
  if (!viewer.isAdmin) {
    if (ownerId !== viewer.userId) return null;
    if (data.is_internal) return null;
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(data.storage_path as string, SIGNED_URL_TTL_SECONDS);
  if (signError) throw signError;
  return signed?.signedUrl ?? null;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function listTickets(
  userId: string,
  params: { page: number; pageSize: number },
): Promise<{ rows: TicketSummary[]; total: number; page: number; page_size: number }> {
  const from = (params.page - 1) * params.pageSize;
  const { data, error, count } = await supabaseAdmin
    .from("support_tickets")
    .select(TICKET_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .range(from, from + params.pageSize - 1);
  if (error) throw error;

  return {
    rows: ((data ?? []) as unknown as TicketRow[]).map(toSummary),
    total: count ?? 0,
    page: params.page,
    page_size: params.pageSize,
  };
}

export async function countUnreadTickets(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("support_tickets")
    .select("last_message_role, last_message_at, user_read_at")
    .eq("user_id", userId)
    .eq("last_message_role", "admin");
  if (error) throw error;
  return (data ?? []).filter((row) =>
    !row.user_read_at || new Date(row.user_read_at as string).getTime() < new Date(row.last_message_at as string).getTime(),
  ).length;
}

async function loadMessages(ticketId: string, includeInternal: boolean): Promise<TicketMessage[]> {
  let messageQuery = supabaseAdmin
    .from("support_messages")
    .select("id, author_role, body, created_at, is_internal")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  // THE internal-note boundary. If this line is ever removed, internal admin
  // notes are served to customers.
  if (!includeInternal) messageQuery = messageQuery.eq("is_internal", false);

  const { data: messages, error } = await messageQuery;
  if (error) throw error;

  let attachmentQuery = supabaseAdmin
    .from("support_attachments")
    .select("id, message_id, filename, mime, size_bytes, is_internal")
    .eq("ticket_id", ticketId);
  if (!includeInternal) attachmentQuery = attachmentQuery.eq("is_internal", false);

  const { data: attachments, error: attachmentError } = await attachmentQuery;
  if (attachmentError) throw attachmentError;

  const byMessage = new Map<string, TicketAttachment[]>();
  for (const row of attachments ?? []) {
    const key = row.message_id as string | null;
    if (!key) continue;
    const list = byMessage.get(key) ?? [];
    list.push({
      id: row.id as string,
      filename: row.filename as string,
      mime: row.mime as string,
      size_bytes: row.size_bytes as number,
    });
    byMessage.set(key, list);
  }

  return (messages ?? []).map((row) => ({
    id: row.id as string,
    author_role: row.author_role as TicketMessage["author_role"],
    body: row.body as string,
    created_at: row.created_at as string,
    attachments: byMessage.get(row.id as string) ?? [],
  }));
}

// viewer.userId is null only for an admin caller. A non-admin viewer is always
// filtered by user_id, so a guessed ticket id returns null rather than someone
// else's thread.
export async function getTicketDetail(
  ticketId: string,
  viewer: { userId: string | null; isAdmin: boolean },
): Promise<TicketDetail | null> {
  let query = supabaseAdmin.from("support_tickets").select(TICKET_COLUMNS).eq("id", ticketId);
  if (!viewer.isAdmin) {
    if (!viewer.userId) return null;
    query = query.eq("user_id", viewer.userId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as TicketRow;
  return {
    ...toSummary(row),
    related_ticket_id: row.related_ticket_id,
    messages: await loadMessages(ticketId, viewer.isAdmin),
  };
}

export async function markTicketRead(ticketId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("support_tickets")
    .update({ user_read_at: new Date().toISOString() })
    .eq("id", ticketId)
    .eq("user_id", userId);
  if (error) throw error;
}

// ── writes ──────────────────────────────────────────────────────────────

async function appendMessage(params: {
  ticketId: string;
  userId: string;
  body: string;
  attachments: ValidatedAttachment[];
  nextStatus?: TicketSummary["status"];
}): Promise<void> {
  const now = new Date().toISOString();

  const { data: message, error: messageError } = await supabaseAdmin
    .from("support_messages")
    .insert({ ticket_id: params.ticketId, author_id: params.userId, author_role: "user", body: params.body })
    .select("id")
    .single();
  if (messageError) throw messageError;

  await insertAttachments(params.ticketId, message.id as string, params.userId, params.attachments);

  const patch: Record<string, unknown> = {
    last_message_at: now,
    last_message_role: "user",
    // The user has by definition seen their own message; leaving user_read_at
    // stale here would light up their own unread dot.
    user_read_at: now,
    // A user reply means support is no longer waiting on them, so the ticket
    // returns to the queue as unread for admins.
    admin_read_at: null,
  };
  if (params.nextStatus) {
    patch.status = params.nextStatus;
    if (params.nextStatus === "open") patch.resolved_at = null;
  }

  const { error: patchError } = await supabaseAdmin
    .from("support_tickets")
    .update(patch)
    .eq("id", params.ticketId);
  if (patchError) throw patchError;
}

export async function createTicket(params: {
  userId: string;
  category: TicketCategory;
  subject: string;
  body: string;
  source: TicketSource;
  attachmentPaths: string[];
  contextRefType?: "run" | "list" | "payment" | null;
  contextRefId?: string | null;
  relatedTicketId?: string | null;
}): Promise<CreateTicketResult> {
  const ctx = await getRequesterContext(params.userId);
  if (!ctx) throw new Error("Requester profile not found");

  if (isMuted(ctx)) return { ok: false, reason: "muted", until: ctx.support_muted_until };

  // Cheap guard against a stuck client retrying in a loop. Keyed on the user's
  // most recent ticket regardless of status.
  const { data: latest, error: latestError } = await supabaseAdmin
    .from("support_tickets")
    .select("created_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (latestError) throw latestError;

  if (latest && latest.length > 0) {
    const elapsed = (Date.now() - new Date(latest[0].created_at as string).getTime()) / 1000;
    if (elapsed < MIN_SECONDS_BETWEEN_TICKETS) {
      return { ok: false, reason: "rate_limited", retry_after_seconds: Math.ceil(MIN_SECONDS_BETWEEN_TICKETS - elapsed) };
    }
  }

  const validation = await validateAttachments(params.userId, params.attachmentPaths);
  if (!validation.ok) return { ok: false, reason: "invalid_attachment", detail: validation.detail };

  // Over the cap, a new submission becomes a reply on the newest active thread
  // rather than an error. A user with something to say should never hit a dead
  // end — they just don't get to fan it out across parallel tickets.
  const cap = isLockedOut(ctx) ? MAX_OPEN_TICKETS_LOCKED_OUT : MAX_OPEN_TICKETS_DEFAULT;
  const { data: active, error: activeError } = await supabaseAdmin
    .from("support_tickets")
    .select("id")
    .eq("user_id", params.userId)
    .in("status", ACTIVE_TICKET_STATUSES)
    .order("last_message_at", { ascending: false });
  if (activeError) throw activeError;

  if ((active?.length ?? 0) >= cap) {
    const targetId = active![0].id as string;
    await appendMessage({
      ticketId: targetId,
      userId: params.userId,
      body: `[${params.subject}]\n\n${params.body}`,
      attachments: validation.attachments,
      nextStatus: "open",
    });
    await supabaseAdmin.from("support_events").insert({
      ticket_id: targetId,
      actor_id: params.userId,
      actor_role: "user",
      event_type: "capped",
      note: `Open-ticket cap of ${cap} reached; submission appended to this thread`,
    });
    const ticket = await getTicketDetail(targetId, { userId: params.userId, isAdmin: false });
    return { ok: true, ticket: ticket!, appended: true };
  }

  const now = new Date().toISOString();
  const hash = dedupeHash(params.category, params.subject, params.body);

  const { data: created, error: createError } = await supabaseAdmin
    .from("support_tickets")
    .insert({
      user_id: params.userId,
      category: params.category,
      subject: params.subject.trim(),
      source: params.source,
      account_status_at_submit: ctx.account_status,
      context_ref_type: params.contextRefType ?? null,
      context_ref_id: params.contextRefId ?? null,
      related_ticket_id: params.relatedTicketId ?? null,
      last_message_at: now,
      last_message_role: "user",
      user_read_at: now,
      dedupe_hash: hash,
    })
    .select("id")
    .single();

  if (createError) {
    // 23505 on support_tickets_dedupe_idx: the identical submission is already
    // in flight or landed a moment ago (double-click, retried request). Return
    // the existing ticket instead of an error — the user's intent is satisfied.
    if (createError.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("support_tickets")
        .select("id")
        .eq("user_id", params.userId)
        .eq("dedupe_hash", hash)
        .in("status", ACTIVE_TICKET_STATUSES)
        .limit(1)
        .maybeSingle();
      if (existing) {
        const ticket = await getTicketDetail(existing.id as string, { userId: params.userId, isAdmin: false });
        if (ticket) return { ok: true, ticket, appended: false };
      }
    }
    throw createError;
  }

  const ticketId = created.id as string;

  // A ticket with no message is a support agent staring at a subject line. If
  // the message insert fails, remove the shell rather than leaving one behind
  // — and the dedupe index frees up so the user's retry works.
  try {
    const { data: message, error: messageError } = await supabaseAdmin
      .from("support_messages")
      .insert({ ticket_id: ticketId, author_id: params.userId, author_role: "user", body: params.body })
      .select("id")
      .single();
    if (messageError) throw messageError;

    await insertAttachments(ticketId, message.id as string, params.userId, validation.attachments);
  } catch (err) {
    await supabaseAdmin.from("support_tickets").delete().eq("id", ticketId);
    throw err;
  }

  await supabaseAdmin.from("support_events").insert({
    ticket_id: ticketId,
    actor_id: params.userId,
    actor_role: "user",
    event_type: "created",
    to_value: "open",
    note: `Raised from ${params.source} while account_status was ${ctx.account_status}`,
  });

  const ticket = await getTicketDetail(ticketId, { userId: params.userId, isAdmin: false });
  return { ok: true, ticket: ticket!, appended: false };
}

export async function replyToTicket(params: {
  userId: string;
  ticketId: string;
  body: string;
  attachmentPaths: string[];
}): Promise<ReplyResult> {
  const ctx = await getRequesterContext(params.userId);
  if (!ctx) throw new Error("Requester profile not found");
  if (isMuted(ctx)) return { ok: false, reason: "muted", until: ctx.support_muted_until };

  const { data: ticket, error } = await supabaseAdmin
    .from("support_tickets")
    .select("id, status, resolved_at")
    .eq("id", params.ticketId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (error) throw error;
  if (!ticket) return { ok: false, reason: "not_found" };

  // 'closed' is final. The route turns this into a 409 and the UI offers a new
  // ticket linked back via related_ticket_id.
  if (ticket.status === "closed") return { ok: false, reason: "closed" };

  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count, error: countError } = await supabaseAdmin
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", params.ticketId)
    .eq("author_role", "user")
    .gte("created_at", since);
  if (countError) throw countError;

  if ((count ?? 0) >= MAX_MESSAGES_PER_TICKET_PER_HOUR) {
    return { ok: false, reason: "rate_limited", retry_after_seconds: 600 };
  }

  const validation = await validateAttachments(params.userId, params.attachmentPaths);
  if (!validation.ok) return { ok: false, reason: "invalid_attachment", detail: validation.detail };

  // A reply to a resolved ticket reopens it, but only inside the window —
  // otherwise a months-old thread springs back to life instead of starting a
  // conversation an agent can actually pick up cold.
  let reopened = false;
  let nextStatus: TicketSummary["status"] | undefined;
  if (ticket.status === "resolved") {
    const resolvedAt = ticket.resolved_at ? new Date(ticket.resolved_at as string).getTime() : 0;
    const withinWindow = Date.now() - resolvedAt <= REOPEN_WINDOW_DAYS * 86400 * 1000;
    if (withinWindow) {
      nextStatus = "open";
      reopened = true;
    }
  } else if (ticket.status === "waiting_on_user") {
    nextStatus = "open";
  }

  await appendMessage({
    ticketId: params.ticketId,
    userId: params.userId,
    body: params.body,
    attachments: validation.attachments,
    nextStatus,
  });

  if (reopened) {
    await supabaseAdmin.from("support_events").insert({
      ticket_id: params.ticketId,
      actor_id: params.userId,
      actor_role: "user",
      event_type: "reopened",
      from_value: "resolved",
      to_value: "open",
    });
  }

  const detail = await getTicketDetail(params.ticketId, { userId: params.userId, isAdmin: false });
  return { ok: true, ticket: detail!, reopened };
}
