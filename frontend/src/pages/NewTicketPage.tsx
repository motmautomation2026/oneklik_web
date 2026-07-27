import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Form, Spinner } from "react-bootstrap";
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
        <div className="mb-3">
          <Link to="/support" className="small">
            ← All requests
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

        <Card className="border-0 shadow-sm">
          <Card.Body className="p-4">
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3" controlId="ticketCategory">
                <Form.Label>What's it about?</Form.Label>
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

              <Form.Group className="mb-3" controlId="ticketSubject">
                <Form.Label>Subject</Form.Label>
                <Form.Control
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={MAX_SUBJECT_LENGTH}
                  placeholder="A one-line summary"
                  disabled={submitting}
                />
              </Form.Group>

              <Form.Group className="mb-3" controlId="ticketBody">
                <Form.Label>What happened?</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={7}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={MAX_BODY_LENGTH}
                  placeholder="Include anything that helps us reproduce it — what you did, what you expected, what happened instead."
                  disabled={submitting}
                />
                <Form.Text className="text-body-secondary">
                  {body.length}/{MAX_BODY_LENGTH}
                </Form.Text>
              </Form.Group>

              <Form.Group className="mb-3" controlId="ticketFiles">
                <Form.Label>
                  Attachments <span className="text-body-secondary fw-normal">(optional)</span>
                </Form.Label>
                <Form.Control
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  onChange={(e) => handleFiles((e.target as HTMLInputElement).files)}
                  disabled={submitting || files.length >= MAX_ATTACHMENTS}
                />
                <Form.Text className="text-body-secondary">
                  Screenshots help a lot. Up to {MAX_ATTACHMENTS} files, 5 MB each — PNG, JPEG, WEBP or PDF.
                </Form.Text>
                {files.length > 0 && (
                  <div className="mt-2 d-flex flex-wrap gap-2">
                    {files.map((file, index) => (
                      <Badge key={`${file.name}-${index}`} bg="light" text="dark" className="border py-2">
                        {file.name}
                        {!submitting && (
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
              </Form.Group>

              <div className="d-flex align-items-center gap-3">
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
                <Link to="/support" className="small text-body-secondary">
                  Cancel
                </Link>
              </div>
            </Form>
          </Card.Body>
        </Card>
      </div>
    </SupportLayout>
  );
}
