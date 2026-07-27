import { useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import {
  fetchAdmins,
  fetchSupportAttachmentUrl,
  fetchSupportTicket,
  markSupportTicketRead,
  patchSupportTicket,
  postSupportMessage,
  setSupportMute,
} from "../api/adminApi";
import SectionCard from "../components/SectionCard";
import { ACCOUNT_STATUS_VARIANT, TICKET_PRIORITY_VARIANT, TICKET_STATUS_VARIANT } from "../badgeVariants";
import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { ADMIN_CHART_COLORS } from "../theme";
import {
  TICKET_CATEGORY_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUS_LABEL,
  TICKET_STATUSES,
  type AdminTicketDetail,
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
    <Button variant="outline-secondary" size="sm" disabled={opening} onClick={open} className="me-2 mt-2">
      {opening ? "Opening…" : `${attachment.filename} (${formatBytes(attachment.size_bytes)})`}
    </Button>
  );
}

function Message({ message }: { message: AdminTicketMessage }) {
  const fromUs = message.author_role === "admin";
  const internal = message.is_internal;

  // Internal notes get their own visual language — amber, dashed, explicitly
  // labelled. An agent skimming a thread must never have to read carefully to
  // tell what the customer can see.
  const background = internal ? "#fff8e1" : fromUs ? ADMIN_CHART_COLORS.surface : "#f6f5fb";
  const border = internal ? "#e0a800" : ADMIN_CHART_COLORS.grid;

  return (
    <div
      className="rounded-3 p-3 mb-3"
      style={{
        background,
        border: `1px ${internal ? "dashed" : "solid"} ${border}`,
        marginLeft: fromUs ? 32 : 0,
        marginRight: fromUs ? 0 : 32,
      }}
    >
      <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
        {internal && (
          <Badge bg="warning" text="dark">
            Internal note — not visible to customer
          </Badge>
        )}
        <span className="small fw-semibold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          {message.author_role === "system" ? "System" : message.author_email ?? (fromUs ? "Support" : "Customer")}
        </span>
        <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
          {formatDateTime(message.created_at)}
        </span>
      </div>
      {/* Plain text, pre-wrap. Never dangerouslySetInnerHTML — this is
          user-supplied content. */}
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: ADMIN_CHART_COLORS.ink.primary }}>
        {message.body}
      </div>
      {message.attachments.length > 0 && (
        <div>
          {message.attachments.map((a) => (
            <AttachmentLink key={a.id} attachment={a} />
          ))}
        </div>
      )}
    </div>
  );
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

  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [muteUntil, setMuteUntil] = useState("");

  // Opening the thread is what marks it read for the team — the badge and the
  // queue's unread dot both key off admin_read_at.
  useEffect(() => {
    if (!ticket?.admin_unread) return;
    markSupportTicketRead(id).catch(() => undefined);
  }, [id, ticket?.admin_unread]);

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
      <div className="mb-3">
        <Link to="/admin/support" className="small">
          ← Back to queue
        </Link>
      </div>

      <div className="d-flex align-items-start justify-content-between gap-3 mb-4 flex-wrap">
        <div style={{ minWidth: 0 }}>
          <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            {ticket.subject}
          </h1>
          <div className="d-flex align-items-center gap-2 flex-wrap small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            <span>#{ticket.ticket_number}</span>
            <span>·</span>
            <span>{TICKET_CATEGORY_LABEL[ticket.category]}</span>
            <span>·</span>
            <span>Raised {formatDateTime(ticket.created_at)}</span>
            {ticket.source === "lockout" && (
              <Badge bg="warning" text="dark" title="Raised from the account lockout screen">
                Appeal
              </Badge>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Badge bg={TICKET_STATUS_VARIANT[ticket.status] ?? "secondary"}>{TICKET_STATUS_LABEL[ticket.status]}</Badge>
          <Badge bg={TICKET_PRIORITY_VARIANT[ticket.priority] ?? "secondary"}>{ticket.priority}</Badge>
        </div>
      </div>

      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError(null)} className="py-2 small">
          {actionError}
        </Alert>
      )}

      <div className="row g-3">
        <div className="col-12 col-lg-8">
          <SectionCard title="Conversation" loading={false} error={null}>
            {ticket.messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}

            {/* The composer's own chrome changes with the mode. A checkbox
                alone is too easy to miss; sending an internal note to a
                customer is the one mistake in this console that cannot be
                taken back. */}
            <div
              className="rounded-3 p-3 mt-3"
              style={{
                background: internal ? "#fff8e1" : ADMIN_CHART_COLORS.surface,
                border: `1px ${internal ? "dashed #e0a800" : `solid ${ADMIN_CHART_COLORS.grid}`}`,
              }}
            >
              <div className="d-flex gap-2 mb-2">
                <Button
                  size="sm"
                  variant={internal ? "outline-secondary" : "primary"}
                  onClick={() => setInternal(false)}
                  type="button"
                >
                  Reply to customer
                </Button>
                <Button
                  size="sm"
                  variant={internal ? "warning" : "outline-secondary"}
                  onClick={() => setInternal(true)}
                  type="button"
                >
                  Internal note
                </Button>
              </div>

              <Form.Control
                as="textarea"
                rows={4}
                maxLength={5000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={internal ? "Visible only to admins…" : "This will be sent to the customer…"}
              />

              <div className="d-flex align-items-center justify-content-between mt-2 gap-2">
                <span className="small" style={{ color: internal ? "#8a6d00" : ADMIN_CHART_COLORS.ink.muted }}>
                  {internal
                    ? "Internal note — the customer will not see this."
                    : ticket.status === "closed"
                      ? "This ticket is closed; replying will not reopen it for the customer."
                      : "The customer will see this reply."}
                </span>
                <Button
                  size="sm"
                  variant={internal ? "warning" : "primary"}
                  disabled={sending || !reply.trim()}
                  onClick={handleSend}
                >
                  {sending ? "Sending…" : internal ? "Save note" : "Send reply"}
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="col-12 col-lg-4">
          <div className="mb-3">
            <SectionCard title="Requester" loading={false} error={null}>
              <div className="small">
                <div className="mb-2">
                  <Link to={`/admin/users/${ticket.user_id}`}>{ticket.email ?? ticket.user_id}</Link>
                </div>
                {ticket.requester.company && (
                  <div className="mb-2" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                    {ticket.requester.company}
                  </div>
                )}
                <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <Badge bg={ACCOUNT_STATUS_VARIANT[ticket.requester.account_status] ?? "secondary"}>
                    {ticket.requester.account_status}
                  </Badge>
                  {ticket.account_status_at_submit !== ticket.requester.account_status && (
                    <span style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                      was {ticket.account_status_at_submit} when raised
                    </span>
                  )}
                </div>
                {ticket.requester.status_reason && (
                  <div className="mb-2" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                    Restriction reason: {ticket.requester.status_reason}
                  </div>
                )}
                <div className="mb-2">Balance: {formatNumber(ticket.requester.available_balance)} credits</div>
                <div className="mb-2">Other tickets: {formatNumber(ticket.requester.other_ticket_count)}</div>

                {ticket.requester.account_status !== "active" && (
                  <Alert variant="warning" className="py-2 small mb-2">
                    This account is {ticket.requester.account_status}. Resolve the appeal from the{" "}
                    <Link to={`/admin/users/${ticket.user_id}`}>user page</Link>, then update this ticket.
                  </Alert>
                )}

                {muted && (
                  <Alert variant="secondary" className="py-2 small mb-2">
                    Support muted until {formatDateTime(ticket.requester.support_muted_until!)}.{" "}
                    <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => handleMute(null)}>
                      Lift mute
                    </button>
                  </Alert>
                )}
                {!muted && (
                  <Button size="sm" variant="outline-secondary" onClick={() => setMuteOpen(true)}>
                    Mute new messages…
                  </Button>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="mb-3">
            <SectionCard title="Manage" loading={false} error={null}>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1">Status</Form.Label>
                <Form.Select
                  size="sm"
                  value={ticket.status}
                  onChange={(e) => patch({ status: e.target.value as TicketStatus })}
                >
                  {TICKET_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TICKET_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-2">
                <Form.Label className="small mb-1">Priority</Form.Label>
                <Form.Select
                  size="sm"
                  value={ticket.priority}
                  onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
                >
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group>
                <Form.Label className="small mb-1">Assignee</Form.Label>
                <Form.Select
                  size="sm"
                  value={ticket.assigned_to ?? ""}
                  onChange={(e) => patch({ assigned_to: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {(admins.data ?? []).map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.email ?? a.user_id}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </SectionCard>
          </div>

          <SectionCard title="History" loading={false} error={null}>
            {ticket.events.length === 0 ? (
              <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                Nothing yet.
              </div>
            ) : (
              <ul className="list-unstyled mb-0 small">
                {ticket.events.map((e) => (
                  <li key={e.id} className="mb-2">
                    <div style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
                      {e.event_type.replace(/_/g, " ")}
                      {e.from_value || e.to_value ? `: ${e.from_value ?? "—"} → ${e.to_value ?? "—"}` : ""}
                    </div>
                    <div style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                      {formatDateTime(e.created_at)}
                      {e.actor_email ? ` · ${e.actor_email}` : ` · ${e.actor_role}`}
                    </div>
                    {e.note && <div style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>{e.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

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
