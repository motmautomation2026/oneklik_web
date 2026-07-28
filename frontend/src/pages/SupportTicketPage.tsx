import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Form, Spinner } from "react-bootstrap";
import { ArrowLeft } from "react-bootstrap-icons";
import { Link, useParams, useSearchParams } from "react-router-dom";
import SupportLayout from "../components/SupportLayout";
import { useAuth } from "../lib/AuthProvider";
import {
  fetchAttachmentUrl,
  fetchMyTicket,
  markTicketRead,
  MAX_ATTACHMENTS,
  MAX_BODY_LENGTH,
  replyToTicket,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_VARIANT,
  uploadAttachment,
  validateFile,
  type TicketAttachment,
  type TicketDetail,
} from "../lib/supportApi";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentLink({ attachment }: { attachment: TicketAttachment }) {
  const [opening, setOpening] = useState(false);

  async function open() {
    setOpening(true);
    try {
      const { url } = await fetchAttachmentUrl(attachment.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button variant="outline-secondary" size="sm" className="me-2 mt-2" disabled={opening} onClick={open}>
      {opening ? "Opening…" : `${attachment.filename} (${formatBytes(attachment.size_bytes)})`}
    </Button>
  );
}

export default function SupportTicketPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const appended = searchParams.get("appended") === "1";

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchMyTicket(id, signal)
        .then((res) => {
          setTicket(res.ticket);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setLoadError(err instanceof Error ? err.message : "Could not load this request.");
        }),
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Clears the unread dot in the topbar and on the list. Fired once the thread
  // is actually on screen, not on hover or navigation intent.
  useEffect(() => {
    if (!ticket?.has_unread) return;
    markTicketRead(id).catch(() => undefined);
  }, [id, ticket?.has_unread]);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    for (const file of Array.from(list)) {
      const problem = validateFile(file);
      if (problem) {
        setSendError(problem);
        return;
      }
      next.push(file);
    }
    if (files.length + next.length > MAX_ATTACHMENTS) {
      setSendError(`You can attach at most ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    setSendError(null);
    setFiles((prev) => [...prev, ...next]);
  }

  async function handleReply() {
    const body = reply.trim();
    if (!body || !user) return;
    setSending(true);
    setSendError(null);
    try {
      const paths: string[] = [];
      for (const file of files) paths.push(await uploadAttachment(user.id, file));

      const result = await replyToTicket(id, body, paths);
      setTicket(result.ticket);
      setReply("");
      setFiles([]);
      setNotice(result.reopened ? "Your request has been reopened and is back with our team." : null);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send your reply.");
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <SupportLayout>
        <div className="p-md-4 p-3">
          <Alert variant="danger">
            {loadError} <Link to="/support">Back to your requests</Link>
          </Alert>
        </div>
      </SupportLayout>
    );
  }

  if (!ticket) {
    return (
      <SupportLayout>
        <div className="d-flex justify-content-center py-5">
          <Spinner animation="border" />
        </div>
      </SupportLayout>
    );
  }

  const closed = ticket.status === "closed";

  return (
    <SupportLayout>
      <div className="p-md-4 p-3">
        <div className="mb-3">
          <Link to="/support" className="ticket-back-link">
            <ArrowLeft size={14} />
            All requests
          </Link>
        </div>

        <div className="d-flex align-items-start justify-content-between gap-3 mb-4 flex-wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="h5 mb-1">{ticket.subject}</h1>
            <div className="small text-body-secondary">
              #{ticket.ticket_number} · Raised {formatWhen(ticket.created_at)}
            </div>
          </div>
          <Badge bg={TICKET_STATUS_VARIANT[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Badge>
        </div>

        {appended && (
          <Alert variant="info" className="small">
            You already have the maximum number of open requests, so your message was added to this conversation instead of
            starting a new one.
          </Alert>
        )}
        {notice && (
          <Alert variant="success" className="small" dismissible onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {ticket.messages.map((message) => {
          const fromUs = message.author_role === "admin";
          return (
            <Card
              key={message.id}
              className="border-0 shadow-sm mb-3"
              style={{ marginLeft: fromUs ? 0 : 24, marginRight: fromUs ? 24 : 0 }}
            >
              <Card.Body className="py-3">
                <div className="small text-body-secondary mb-2">
                  <span className="fw-semibold text-body">
                    {message.author_role === "system" ? "System" : fromUs ? "One-Klik Support" : "You"}
                  </span>
                  {" · "}
                  {formatWhen(message.created_at)}
                </div>
                {/* Plain text with preserved line breaks. Never rendered as HTML. */}
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.body}</div>
                {message.attachments.length > 0 && (
                  <div>
                    {message.attachments.map((a) => (
                      <AttachmentLink key={a.id} attachment={a} />
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          );
        })}

        {closed ? (
          <Card className="border-0 shadow-sm">
            <Card.Body className="text-center py-4">
              <p className="text-body-secondary mb-3 small">
                This request is closed. If you still need help, start a new one and mention #{ticket.ticket_number}.
              </p>
              <Link to="/support/new" className="btn btn-primary btn-sm">
                Raise a new request
              </Link>
            </Card.Body>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <Card.Body>
              {sendError && (
                <Alert variant="danger" className="small" dismissible onClose={() => setSendError(null)}>
                  {sendError}
                </Alert>
              )}
              <Form.Control
                as="textarea"
                rows={4}
                value={reply}
                maxLength={MAX_BODY_LENGTH}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Add a reply…"
                disabled={sending}
              />
              <div className="d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap">
                <div>
                  <Form.Control
                    type="file"
                    size="sm"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(e) => handleFiles((e.target as HTMLInputElement).files)}
                    disabled={sending || files.length >= MAX_ATTACHMENTS}
                    style={{ maxWidth: 260 }}
                  />
                  {files.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {files.map((file, index) => (
                        <Badge key={`${file.name}-${index}`} bg="light" text="dark" className="border py-2">
                          {file.name}
                          {!sending && (
                            <button
                              type="button"
                              className="btn-close ms-2"
                              style={{ fontSize: "0.6rem" }}
                              aria-label={`Remove ${file.name}`}
                              onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            />
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="primary" disabled={sending || !reply.trim()} onClick={handleReply}>
                  {sending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </Card.Body>
          </Card>
        )}
      </div>
    </SupportLayout>
  );
}
