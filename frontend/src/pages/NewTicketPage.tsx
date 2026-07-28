import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Form, Spinner } from "react-bootstrap";
import { ArrowLeft } from "react-bootstrap-icons";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import SupportLayout from "../components/SupportLayout";
import { useAuth } from "../lib/AuthProvider";
import { isLockedOut } from "../lib/accountStatus";
import {
  createTicket,
  MAX_ATTACHMENTS,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  SUPPORT_CATEGORIES,
  uploadAttachment,
  validateFile,
  type TicketCategory,
} from "../lib/supportApi";

export default function NewTicketPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const lockedOut = profile ? isLockedOut(profile.account_status, profile.suspended_until) : false;
  // Arriving from the lockout screen means this is an appeal. The category is
  // preselected and the source recorded, so the admin queue can tell an appeal
  // from an ordinary question at a glance.
  const fromLockout = searchParams.get("source") === "lockout" || lockedOut;

  const [category, setCategory] = useState<TicketCategory>(fromLockout ? "account_access" : "other");
  const [subject, setSubject] = useState(fromLockout ? "Appeal: my account is restricted" : "");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const next: File[] = [];
    for (const file of incoming) {
      const problem = validateFile(file);
      if (problem) {
        setError(problem);
        return;
      }
      next.push(file);
    }
    if (files.length + next.length > MAX_ATTACHMENTS) {
      setError(`You can attach at most ${MAX_ATTACHMENTS} files.`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...next]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) {
      setError("Please add a subject and describe the problem.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const paths: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}…`);
        paths.push(await uploadAttachment(user.id, file));
      }
      setProgress("Sending…");

      const result = await createTicket({
        category,
        subject: trimmedSubject,
        body: trimmedBody,
        source: fromLockout ? "lockout" : "app",
        attachment_paths: paths,
      });

      // `appended` means the open-ticket cap was hit and this went onto an
      // existing thread — navigating there rather than to a ticket that was
      // never created keeps the outcome honest.
      navigate(`/support/${result.ticket.id}${result.appended ? "?appended=1" : ""}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
      setSubmitting(false);
      setProgress(null);
    }
  }

  const selected = SUPPORT_CATEGORIES.find((c) => c.value === category);

  return (
    <SupportLayout>
      <div className="p-md-4 p-3">
        <div className="ticket-form-page">
          <div className="mb-3">
            <Link to="/support" className="ticket-back-link">
              <ArrowLeft size={14} />
              All requests
            </Link>
          </div>

          <h1 className="h4 mb-1">Raise a request</h1>
          <p className="text-body-secondary small mb-4">
            Tell us what's happening and we'll reply here. You'll see our answer on your support page.
          </p>

          {lockedOut && (
            <Alert variant="warning" className="small">
              Your account is currently restricted. You can still write to us here, and we'll review it.
            </Alert>
          )}

          {error && (
            <Alert variant="danger" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Card className="border-0 shadow-sm ticket-form-card">
            <Card.Body>
              <Form onSubmit={handleSubmit} className="ticket-form">
                <Form.Group className="mb-4" controlId="ticketCategory">
                  <div className="ticket-field-head">
                    <Form.Label>What's it about?</Form.Label>
                  </div>
                  <Form.Select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    disabled={submitting}
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Form.Select>
                  {selected && <Form.Text className="text-body-secondary">{selected.hint}</Form.Text>}
                </Form.Group>

                <Form.Group className="mb-4" controlId="ticketSubject">
                  <div className="ticket-field-head">
                    <Form.Label>Subject</Form.Label>
                    <span className="ticket-counter">
                      {subject.length}/{MAX_SUBJECT_LENGTH}
                    </span>
                  </div>
                  <Form.Control
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={MAX_SUBJECT_LENGTH}
                    placeholder="A one-line summary"
                    disabled={submitting}
                  />
                </Form.Group>

                <Form.Group className="mb-4" controlId="ticketBody">
                  <div className="ticket-field-head">
                    <Form.Label>What happened?</Form.Label>
                    <span className="ticket-counter">
                      {body.length}/{MAX_BODY_LENGTH}
                    </span>
                  </div>
                  <Form.Control
                    as="textarea"
                    rows={7}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={MAX_BODY_LENGTH}
                    placeholder="Include anything that helps us reproduce it — what you did, what you expected, what happened instead."
                    disabled={submitting}
                  />
                </Form.Group>

                <Form.Group className="mb-0" controlId="ticketFiles">
                  <div className="ticket-field-head">
                    <span className="ticket-field-label">
                      Attachments <span className="text-body-secondary fw-normal">· optional</span>
                    </span>
                    <span className="ticket-counter">
                      {files.length}/{MAX_ATTACHMENTS}
                    </span>
                  </div>
                  {/* The native file input is the control; the panel is its
                      label, so clicking it opens the picker with no JS and
                      goes inert on its own while the input is disabled. */}
                  <Form.Label
                    className={`ticket-dropzone${
                      submitting || files.length >= MAX_ATTACHMENTS ? " is-disabled" : ""
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
                    </svg>
                    <span className="ticket-dropzone-title">
                      {files.length >= MAX_ATTACHMENTS ? "Attachment limit reached" : "Add a screenshot or PDF"}
                    </span>
                    <span className="ticket-dropzone-hint">
                      Screenshots help a lot. Up to {MAX_ATTACHMENTS} files, 5 MB each — PNG, JPEG, WEBP or PDF.
                    </span>
                  </Form.Label>
                  <Form.Control
                    type="file"
                    className="d-none"
                    multiple
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(e) => handleFiles((e.target as HTMLInputElement).files)}
                    disabled={submitting || files.length >= MAX_ATTACHMENTS}
                  />
                  {files.length > 0 && (
                    <div className="mt-2 d-flex flex-wrap gap-2">
                      {files.map((file, index) => (
                        <span key={`${file.name}-${index}`} className="ticket-file-chip" title={file.name}>
                          <span>{file.name}</span>
                          {!submitting && (
                            <button
                              type="button"
                              className="btn-close"
                              style={{ fontSize: "0.6rem" }}
                              aria-label={`Remove ${file.name}`}
                              onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </Form.Group>

                <div className="ticket-form-footer">
                  <Link to="/support" className="small text-body-secondary text-decoration-none">
                    Cancel
                  </Link>
                  <Button type="submit" variant="primary" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        {progress ?? "Sending…"}
                      </>
                    ) : (
                      "Send request"
                    )}
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </div>
      </div>
    </SupportLayout>
  );
}
