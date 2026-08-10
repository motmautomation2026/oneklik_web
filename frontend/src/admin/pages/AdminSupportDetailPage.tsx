import { useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BoxArrowUpRight,
  ChatLeftTextFill,
  ClockFill,
  JournalText,
  PencilSquare,
  PersonFill,
  ReplyFill,
  ShieldLockFill,
  ThreeDotsVertical,
  Paperclip,
} from "react-bootstrap-icons";
import {
  fetchAdmins,
  fetchSupportAttachmentUrl,
  fetchSupportTicket,
  fetchSupportTicketEvents,
  fetchSupportTicketMessages,
  markSupportTicketRead,
  patchSupportTicket,
  postSupportMessage,
  setSupportMute,
} from "../api/adminApi";
import { TICKET_PRIORITY_VARIANT, TICKET_STATUS_VARIANT } from "../badgeVariants";

import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { ADMIN_CHART_COLORS } from "../theme";
import {
  TICKET_CATEGORY_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUS_LABEL,
  TICKET_STATUSES,
  type AdminTicketDetail,
  type AdminTicketEvent,
  type AdminTicketMessage,
  type TicketAttachment,
  type TicketPriority,
  type TicketStatus,
} from "../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentLink({ attachment }: { attachment: TicketAttachment }) {
  const [opening, setOpening] = useState(false);

  // The bucket is private, so there is no durable URL to link to — a
  // short-lived signed URL is minted per click. Opening the tab before the
  // await would be blocked as a popup, so the anchor is synthesised after.
  async function open() {
    setOpening(true);
    try {
      const { url } = await fetchSupportAttachmentUrl(attachment.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button variant="outline-secondary" size="sm" disabled={opening} onClick={open} className="me-2 mt-2" style={{ borderRadius: 6, fontSize: "0.8rem" }}>
      <Paperclip size={12} className="me-1" />
      {opening ? "Opening…" : `${attachment.filename} (${formatBytes(attachment.size_bytes)})`}
    </Button>
  );
}

// Avatar initial circle used in conversations and the requester bar.
function AvatarInitial({ letter, color, size = 32 }: { letter: string; color: string; size?: number }) {
  return (
    <div
      className="d-flex align-items-center justify-content-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${color}15`,
        color,
        fontSize: size * 0.4,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0,
      }}
    >
      {letter}
    </div>
  );
}

function Message({ message }: { message: AdminTicketMessage }) {
  const fromUs = message.author_role === "admin";
  const internal = message.is_internal;

  // Internal notes get their own visual language — amber, dashed, explicitly
  // labelled. An agent skimming a thread must never have to read carefully to
  // tell what the customer can see.
  const background = internal ? "#fffbeb" : fromUs ? "#f8fafc" : ADMIN_CHART_COLORS.surface;
  const border = internal ? "#e0a800" : "#e8e8e4";
  const avatarColor = internal
    ? "#b8860b"
    : fromUs
      ? ADMIN_CHART_COLORS.categorical.blue
      : ADMIN_CHART_COLORS.categorical.aqua;
  const avatarLetter = internal
    ? "N"
    : (message.author_email?.[0] ?? (fromUs ? "A" : "C"));
  const roleLabel = internal
    ? "Internal"
    : fromUs
      ? "You"
      : "Customer";

  return (
    <div
      className="d-flex gap-3 mb-4"
      style={{ marginLeft: fromUs && !internal ? 16 : 0 }}
    >
      <AvatarInitial letter={avatarLetter} color={avatarColor} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
          <span className="fw-semibold small" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            {message.author_role === "system"
              ? "System"
              : message.author_email ?? (fromUs ? "Support" : "Customer")}
          </span>
          <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
            {formatDateTime(message.created_at)}
          </span>
          {internal && (
            <span className="small" style={{ color: "#8a6d00", fontStyle: "italic" }}>
              · Visible to admins only
            </span>
          )}
          <span
            className="small ms-auto"
            style={{
              color: internal ? "#8a6d00" : fromUs ? ADMIN_CHART_COLORS.categorical.blue : ADMIN_CHART_COLORS.ink.muted,
              fontWeight: 500,
            }}
          >
            {roleLabel}
          </span>
        </div>
        <div
          className="rounded-3 p-3"
          style={{
            background,
            border: `1px ${internal ? "dashed" : "solid"} ${border}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: ADMIN_CHART_COLORS.ink.primary,
            fontSize: "0.9rem",
            lineHeight: 1.6,
          }}
        >
          {message.body}
          {message.attachments.length > 0 && (
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${border}` }}>
              {message.attachments.map((a) => (
                <AttachmentLink key={a.id} attachment={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Event type → icon + color for the activity timeline
function eventVisual(eventType: string): { icon: typeof ChatLeftTextFill; color: string } {
  if (eventType.includes("created")) return { icon: ChatLeftTextFill, color: ADMIN_CHART_COLORS.categorical.blue };
  if (eventType.includes("note") || eventType.includes("internal")) return { icon: JournalText, color: "#b8860b" };
  if (eventType.includes("reply") || eventType.includes("message")) return { icon: ReplyFill, color: ADMIN_CHART_COLORS.categorical.aqua };
  if (eventType.includes("status")) return { icon: PencilSquare, color: ADMIN_CHART_COLORS.categorical.orange };
  if (eventType.includes("assign")) return { icon: PersonFill, color: ADMIN_CHART_COLORS.categorical.magenta };
  if (eventType.includes("priority")) return { icon: ShieldLockFill, color: ADMIN_CHART_COLORS.status.warning };
  if (eventType.includes("close") || eventType.includes("resolve")) return { icon: ClockFill, color: ADMIN_CHART_COLORS.categorical.green };
  return { icon: PencilSquare, color: ADMIN_CHART_COLORS.ink.muted };
}

export default function AdminSupportDetailPage() {
  const { id = "" } = useParams();
  const [refetchKey, setRefetchKey] = useState(0);

  const ticketState = useAdminResource(
    (signal) => fetchSupportTicket(id, signal).then((res) => res.ticket),
    [id, refetchKey],
  );
  const admins = useAdminResource((signal) => fetchAdmins().then((r) => r.admins).catch(() => (signal.aborted ? [] : [])), []);

  const ticket: AdminTicketDetail | null = ticketState.data;

  const [messages, setMessages] = useState<AdminTicketMessage[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [events, setEvents] = useState<AdminTicketEvent[]>([]);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [loadingOlderEvents, setLoadingOlderEvents] = useState(false);

  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [muteUntil, setMuteUntil] = useState("");

  // Sync thread pages from the detail payload whenever the ticket reloads.
  useEffect(() => {
    if (!ticket) return;
    setMessages(ticket.messages);
    setMessagesHasMore(ticket.messages_has_more);
    setEvents(ticket.events);
    setEventsHasMore(ticket.events_has_more);
  }, [ticket]);

  // Opening the thread is what marks it read for the team — the badge and the
  // queue's unread dot both key off admin_read_at.
  useEffect(() => {
    if (!ticket?.admin_unread) return;
    markSupportTicketRead(id).catch(() => undefined);
  }, [id, ticket?.admin_unread]);

  async function loadOlderMessages() {
    if (!messages.length || !messagesHasMore) return;
    setLoadingOlderMessages(true);
    setActionError(null);
    try {
      const oldest = messages[0];
      const result = await fetchSupportTicketMessages(id, { before: oldest.created_at });
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = result.messages.filter((m) => !seen.has(m.id));
        return [...older, ...prev];
      });
      setMessagesHasMore(result.has_more);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load older messages.");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function loadOlderEvents() {
    if (!events.length || !eventsHasMore) return;
    setLoadingOlderEvents(true);
    setActionError(null);
    try {
      const oldest = events[0];
      const result = await fetchSupportTicketEvents(id, { before: oldest.created_at });
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const older = result.events.filter((e) => !seen.has(e.id));
        return [...older, ...prev];
      });
      setEventsHasMore(result.has_more);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load older events.");
    } finally {
      setLoadingOlderEvents(false);
    }
  }

  async function handleSend() {
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    setActionError(null);
    try {
      await postSupportMessage(id, body, internal);
      setReply("");
      setInternal(false);
      setRefetchKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  async function patch(update: { status?: TicketStatus; priority?: TicketPriority; assigned_to?: string | null }) {
    setActionError(null);
    try {
      await patchSupportTicket(id, update);
      setRefetchKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update the ticket.");
    }
  }

  async function handleMute(until: string | null) {
    if (!ticket) return;
    setActionError(null);
    try {
      await setSupportMute(id, ticket.user_id, until);
      setMuteOpen(false);
      setMuteUntil("");
      setRefetchKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update the mute.");
    }
  }

  if (ticketState.loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }

  if (ticketState.error || !ticket) {
    return (
      <Alert variant="danger">
        {ticketState.error ?? "Ticket not found."} <Link to="/admin/support">Back to the queue</Link>
      </Alert>
    );
  }

  const muted = ticket.requester.support_muted_until
    ? new Date(ticket.requester.support_muted_until).getTime() > Date.now()
    : false;

  return (
    <>
      {/* ── Back link ──────────────────────────────────────────────────── */}
      <div className="mb-3">
        <Link
          to="/admin/support"
          className="d-inline-flex align-items-center gap-1 small fw-medium"
          style={{ color: ADMIN_CHART_COLORS.categorical.blue, textDecoration: "none" }}
        >
          <ArrowLeft size={14} />
          Back to inbox
        </Link>
      </div>

      {/* ── Ticket header ──────────────────────────────────────────────── */}
      <div className="d-flex align-items-start justify-content-between gap-3 mb-3 flex-wrap">
        <div style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
            <h1 className="h4 mb-0 fw-bold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
              #{ticket.ticket_number}&ensp;{ticket.subject}
            </h1>
            <Badge
              bg={TICKET_STATUS_VARIANT[ticket.status] ?? "secondary"}
              style={{ fontSize: "0.75rem", fontWeight: 500, padding: "4px 10px", borderRadius: 4 }}
            >
              {TICKET_STATUS_LABEL[ticket.status]}
            </Badge>
            <Badge
              bg={TICKET_PRIORITY_VARIANT[ticket.priority] ?? "secondary"}
              style={{ fontSize: "0.75rem", fontWeight: 500, padding: "4px 10px", borderRadius: 4 }}
            >
              {ticket.priority}
            </Badge>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            <span>{TICKET_CATEGORY_LABEL[ticket.category]}</span>
            <span>·</span>
            <span>Created {formatDateTime(ticket.created_at)}</span>
            <span>·</span>
            <span>Via {ticket.source === "lockout" ? "Account lockout" : ticket.source === "app" ? "App" : "Admin"}</span>
            {ticket.source === "lockout" && (
              <Badge bg="warning" text="dark" title="Raised from the account lockout screen" style={{ fontSize: "0.65rem" }}>
                Appeal
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline-secondary" size="sm" style={{ borderRadius: 8 }} title="More actions">
          <ThreeDotsVertical size={16} />
        </Button>
      </div>

      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError(null)} className="py-2 small">
          {actionError}
        </Alert>
      )}

      {/* ── Requester profile bar ──────────────────────────────────────── */}
      <div
        className="rounded-3 border p-3 mb-4 d-flex align-items-center gap-3 flex-wrap"
        style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
      >
        <AvatarInitial
          letter={(ticket.email ?? "U")[0]}
          color={ADMIN_CHART_COLORS.categorical.blue}
          size={40}
        />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <Link
              to={`/admin/users/${ticket.user_id}`}
              className="fw-semibold"
              style={{ color: ADMIN_CHART_COLORS.ink.primary, textDecoration: "none", fontSize: "0.95rem" }}
            >
              {ticket.email ?? ticket.user_id}
            </Link>
            {ticket.requester.company && (
              <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                {ticket.requester.company}
              </span>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center gap-4 flex-wrap small">
          <div className="text-center">
            <div className="d-flex align-items-center gap-1 justify-content-center">
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: ticket.requester.account_status === "active" ? ADMIN_CHART_COLORS.status.good : ADMIN_CHART_COLORS.status.warning,
                  flexShrink: 0,
                }}
              />
              <span className="fw-medium" style={{ textTransform: "capitalize" }}>{ticket.requester.account_status}</span>
            </div>
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted, fontSize: "0.75rem" }}>Account status</div>
          </div>
          <div className="text-center">
            <div className="fw-medium">{formatNumber(ticket.requester.available_balance)}</div>
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted, fontSize: "0.75rem" }}>Credits balance</div>
          </div>
          <div className="text-center">
            <div className="fw-medium">
              {ticket.requester.subscription
                ? (ticket.requester.subscription.plan_name ?? ticket.requester.subscription.plan_id)
                : "No subscription"}
            </div>
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted, fontSize: "0.75rem" }}>Plan</div>
          </div>
        </div>
        <Link
          to={`/admin/users/${ticket.user_id}`}
          className="d-flex align-items-center gap-1 small fw-medium"
          style={{ color: ADMIN_CHART_COLORS.categorical.blue, textDecoration: "none", whiteSpace: "nowrap", borderRadius: 8, border: `1px solid ${ADMIN_CHART_COLORS.grid}`, padding: "6px 12px" }}
        >
          View full profile
          <BoxArrowUpRight size={12} />
        </Link>
      </div>

      <div className="row g-3">
        {/* ── Conversation ────────────────────────────────────────────────── */}
        <div className="col-12 col-lg-8">
          <div
            className="rounded-3 border p-3 h-100"
            style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
          >
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0 fw-semibold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
                Conversation
              </h2>
              <Button variant="link" size="sm" className="d-flex align-items-center gap-1 p-0" style={{ color: ADMIN_CHART_COLORS.ink.muted, textDecoration: "none", fontSize: "0.8rem" }}>
                Oldest first ↓
              </Button>
            </div>

            {messagesHasMore && (
              <div className="text-center mb-3">
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={loadingOlderMessages}
                  onClick={loadOlderMessages}
                  style={{ borderRadius: 8 }}
                >
                  {loadingOlderMessages
                    ? "Loading…"
                    : `Load older messages (${ticket.messages_total - messages.length} more)`}
                </Button>
              </div>
            )}

            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {messages.length === 0 && (
              <div className="small mb-3" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                No messages yet.
              </div>
            )}

            {/* ── Reply composer ────────────────────────────────────────────── */}
            <div
              className="rounded-3 p-3 mt-3"
              style={{
                background: internal ? "#fffbeb" : "#f8fafc",
                border: `1px ${internal ? "dashed #e0a800" : `solid ${ADMIN_CHART_COLORS.grid}`}`,
              }}
            >
              {/* Composer tabs */}
              <div className="d-flex gap-0 mb-3" style={{ borderBottom: `1px solid ${ADMIN_CHART_COLORS.grid}` }}>
                <button
                  type="button"
                  onClick={() => setInternal(false)}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: !internal ? `2px solid ${ADMIN_CHART_COLORS.categorical.blue}` : "2px solid transparent",
                    padding: "6px 14px",
                    cursor: "pointer",
                    color: !internal ? ADMIN_CHART_COLORS.categorical.blue : ADMIN_CHART_COLORS.ink.muted,
                    fontWeight: !internal ? 600 : 400,
                    fontSize: "0.85rem",
                    transition: "all 0.15s ease",
                    marginBottom: -1,
                  }}
                >
                  Reply to customer
                </button>
                <button
                  type="button"
                  onClick={() => setInternal(true)}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: internal ? "2px solid #b8860b" : "2px solid transparent",
                    padding: "6px 14px",
                    cursor: "pointer",
                    color: internal ? "#8a6d00" : ADMIN_CHART_COLORS.ink.muted,
                    fontWeight: internal ? 600 : 400,
                    fontSize: "0.85rem",
                    transition: "all 0.15s ease",
                    marginBottom: -1,
                  }}
                >
                  Internal note
                </button>
              </div>


              <Form.Control
                as="textarea"
                rows={4}
                maxLength={5000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={internal ? "Visible only to admins…" : "Type your reply…"}
                style={{
                  borderRadius: 8,
                  borderColor: ADMIN_CHART_COLORS.grid,
                  fontSize: "0.9rem",
                  resize: "vertical",
                }}
              />

              <div className="d-flex align-items-center justify-content-between mt-3 gap-2 flex-wrap">
                <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                  Press <kbd style={{ fontSize: "0.75rem", padding: "1px 4px", borderRadius: 3, background: "#f0f0ee", border: `1px solid ${ADMIN_CHART_COLORS.grid}` }}>Cmd + Enter</kbd> to send
                </span>
                <div className="d-flex gap-2">
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={!reply.trim()}
                    onClick={() => setReply("")}
                    style={{ borderRadius: 8, padding: "6px 16px" }}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    variant={internal ? "warning" : "success"}
                    disabled={sending || !reply.trim()}
                    onClick={handleSend}
                    className="d-flex align-items-center gap-1"
                    style={{ borderRadius: 8, padding: "6px 20px", fontWeight: 500 }}
                  >
                    {sending ? "Sending…" : internal ? "Save note" : "Send reply"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ──────────────────────────────────────────────── */}
        <div className="col-12 col-lg-4">
          {/* Ticket details card */}
          <div className="mb-3">
            <div
              className="rounded-3 border p-3"
              style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
            >
              <h2 className="h6 mb-3 fw-semibold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
                Ticket details
              </h2>

              {/* Editable fields */}
              <div className="mb-3">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary, minWidth: 80 }}>Status</span>
                  <Form.Select
                    size="sm"
                    value={ticket.status}
                    onChange={(e) => patch({ status: e.target.value as TicketStatus })}
                    style={{ maxWidth: 160, borderRadius: 6, fontSize: "0.85rem", borderColor: ADMIN_CHART_COLORS.grid }}
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Form.Select>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary, minWidth: 80 }}>Priority</span>
                  <Form.Select
                    size="sm"
                    value={ticket.priority}
                    onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
                    style={{ maxWidth: 160, borderRadius: 6, fontSize: "0.85rem", borderColor: ADMIN_CHART_COLORS.grid }}
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Form.Select>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary, minWidth: 80 }}>Assignee</span>
                  <Form.Select
                    size="sm"
                    value={ticket.assigned_to ?? ""}
                    onChange={(e) => patch({ assigned_to: e.target.value || null })}
                    style={{ maxWidth: 160, borderRadius: 6, fontSize: "0.85rem", borderColor: ADMIN_CHART_COLORS.grid }}
                  >
                    <option value="">Unassigned</option>
                    {(admins.data ?? []).map((a) => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.email ?? a.user_id}
                      </option>
                    ))}
                  </Form.Select>
                </div>
              </div>

              {/* Read-only fields */}
              <div style={{ borderTop: `1px solid ${ADMIN_CHART_COLORS.grid}`, paddingTop: 12 }}>
                {[
                  { label: "Category", value: TICKET_CATEGORY_LABEL[ticket.category] },
                  { label: "Source", value: ticket.source === "lockout" ? "Account lockout" : ticket.source === "app" ? "App" : "Admin" },
                  { label: "Ticket ID", value: `#${ticket.ticket_number}` },
                ].map(({ label, value }) => (
                  <div key={label} className="d-flex align-items-center justify-content-between mb-2">
                    <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>{label}</span>
                    <span className="small fw-medium" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Requester alerts */}
              {ticket.requester.account_status !== "active" && (
                <Alert variant="warning" className="py-2 small mb-2 mt-2">
                  This account is {ticket.requester.account_status}. Resolve the appeal from the{" "}
                  <Link to={`/admin/users/${ticket.user_id}`}>user page</Link>, then update this ticket.
                </Alert>
              )}

              {muted && (
                <Alert variant="secondary" className="py-2 small mb-2 mt-2">
                  Support muted until {formatDateTime(ticket.requester.support_muted_until!)}.{" "}
                  <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => handleMute(null)}>
                    Lift mute
                  </button>
                </Alert>
              )}
              {!muted && (
                <div className="mt-2">
                  <Button size="sm" variant="outline-secondary" onClick={() => setMuteOpen(true)} style={{ borderRadius: 6, fontSize: "0.8rem", width: "100%" }}>
                    Mute new messages…
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* ── Activity timeline ──────────────────────────────────────────── */}
          <div
            className="rounded-3 border p-3"
            style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
          >
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0 fw-semibold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
                Activity timeline
              </h2>
              {eventsHasMore && (
                <Button
                  size="sm"
                  variant="link"
                  disabled={loadingOlderEvents}
                  onClick={loadOlderEvents}
                  className="p-0"
                  style={{ fontSize: "0.8rem", textDecoration: "none" }}
                >
                  {loadingOlderEvents ? "Loading…" : "View all"}
                </Button>
              )}
            </div>

            {events.length === 0 ? (
              <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                Nothing yet.
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                {events.map((e, i) => {
                  const { icon: Icon, color } = eventVisual(e.event_type);
                  const isLast = i === events.length - 1;
                  return (
                    <div
                      key={e.id}
                      className="d-flex gap-3"
                      style={{ paddingBottom: isLast ? 0 : 16, position: "relative" }}
                    >
                      {/* Timeline line + dot */}
                      <div className="d-flex flex-column align-items-center" style={{ width: 28, flexShrink: 0 }}>
                        <div
                          className="d-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                          style={{
                            width: 28,
                            height: 28,
                            background: `${color}15`,
                            color,
                            zIndex: 1,
                          }}
                        >
                          <Icon size={13} />
                        </div>
                        {!isLast && (
                          <div
                            style={{
                              width: 2,
                              flex: 1,
                              background: ADMIN_CHART_COLORS.grid,
                              marginTop: 4,
                            }}
                          />
                        )}
                      </div>
                      {/* Event content */}
                      <div style={{ paddingTop: 3, minWidth: 0 }}>
                        <div className="small fw-semibold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
                          {e.event_type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                        </div>
                        {(e.from_value || e.to_value) && (
                          <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                            {e.from_value ?? "—"} → {e.to_value ?? "—"}
                          </div>
                        )}
                        {e.note && (
                          <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                            {e.note}
                          </div>
                        )}
                        <div style={{ fontSize: "0.7rem", color: ADMIN_CHART_COLORS.ink.muted }}>
                          {formatDateTime(e.created_at)}
                          {e.actor_email ? ` · ${e.actor_email}` : ` · ${e.actor_role}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mute modal (unchanged) ───────────────────────────────────────── */}
      <Modal show={muteOpen} onHide={() => setMuteOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h6">Mute new support messages</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small text-body-secondary">
            The requester will not be able to raise tickets or reply until this expires. Existing threads stay readable to
            them. Use this only when someone is flooding the queue.
          </p>
          <Form.Group>
            <Form.Label className="small mb-1">Muted until</Form.Label>
            <Form.Control type="datetime-local" value={muteUntil} onChange={(e) => setMuteUntil(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" size="sm" onClick={() => setMuteOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="warning"
            size="sm"
            disabled={!muteUntil}
            onClick={() => handleMute(new Date(muteUntil).toISOString())}
          >
            Mute
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
