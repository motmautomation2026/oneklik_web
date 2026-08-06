import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
} from "react-bootstrap";
import {
  Clipboard,
  ClipboardCheck,
  EnvelopePaper,
  Stars,
} from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../lib/AuthProvider";
import {
  EMAIL_TEMPLATE_LENGTHS,
  EMAIL_TEMPLATE_TONES,
  fetchEmailTemplate,
  fetchEmailTemplateHistory,
  fetchEmailTemplateUsage,
  generateEmailTemplate,
  rewriteEmailTemplate,
  updateEmailTemplate,
  uploadAttachment,
  validateAttachmentFile,
  type EmailTemplateLength,
  type EmailTemplateListItem,
  type EmailTemplateTone,
  type EmailTemplateUsage,
} from "../lib/emailTemplatesApi";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function preview(text: string | null, max = 80): string {
  if (!text) return "—";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

const BODY_TEXTAREA_MIN_PX = 320;

function OptionGroup<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
  idPrefix,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onChange: (next: T) => void;
  idPrefix: string;
}) {
  return (
    <Form.Group className="mb-3" controlId={idPrefix}>
      <Form.Label className="small fw-medium text-body-secondary mb-2">{label}</Form.Label>
      <div className="email-template-option-group" role="group" aria-label={label}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`email-template-option${active ? " is-active" : ""}`}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </Form.Group>
  );
}

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [companyProfile, setCompanyProfile] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [length, setLength] = useState<EmailTemplateLength>("standard");
  const [tone, setTone] = useState<EmailTemplateTone>("professional");
  const [rewriteLength, setRewriteLength] = useState<EmailTemplateLength>("standard");
  const [rewriteTone, setRewriteTone] = useState<EmailTemplateTone>("professional");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [showRewriteModal, setShowRewriteModal] = useState(false);

  const [usage, setUsage] = useState<EmailTemplateUsage | null>(null);
  const [history, setHistory] = useState<EmailTemplateListItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);

  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultEditable, setResultEditable] = useState(false);

  const [loading, setLoading] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  const profileBlank = !companyProfile.trim();
  const websiteBlank = !companyWebsite.trim();
  const requestBlank = !userRequest.trim();
  const canSubmit = !(profileBlank && websiteBlank && requestBlank);
  const requestRequired = profileBlank && websiteBlank;

  const dirty =
    resultEditable &&
    (editSubject !== (subject ?? "") || editBody !== (body ?? ""));
  const canSave =
    resultEditable &&
    dirty &&
    editSubject.trim().length > 0 &&
    editBody.trim().length > 0 &&
    editSubject.trim().length <= 300;

  const hasResult = Boolean(subject || body || resultEditable);

  function loadResult(next: {
    id: string;
    subject: string | null;
    body: string | null;
    editable: boolean;
  }) {
    setSelectedId(next.id);
    setSubject(next.subject);
    setBody(next.body);
    setEditSubject(next.subject ?? "");
    setEditBody(next.body ?? "");
    setResultEditable(next.editable);
    setSaveNotice(null);
  }

  const refreshUsage = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchEmailTemplateUsage(signal);
    setUsage(next);
  }, []);

  const refreshHistory = useCallback(async (page: number, signal?: AbortSignal) => {
    setHistoryLoading(true);
    try {
      const res = await fetchEmailTemplateHistory(page, 10, signal);
      setHistory(res.items);
      setHistoryTotal(res.total);
      setHistoryPage(res.page);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([refreshUsage(controller.signal), refreshHistory(1, controller.signal)]).catch(
      (err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Could not load email templates");
        }
      },
    );
    return () => controller.abort();
  }, [refreshUsage, refreshHistory]);

  // Grow the body editor with its content so the full email is readable
  // without an inner scrollbar (page scroll handles overflow instead).
  useEffect(() => {
    const el = bodyTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(BODY_TEXTAREA_MIN_PX, el.scrollHeight)}px`;
  }, [editBody, resultEditable, loading]);

  function openRewriteModal() {
    setShowRewriteModal(true);
  }

  function closeRewriteModal() {
    if (rewriting) return;
    setShowRewriteModal(false);
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !user) return;

    setLoading(true);
    setError(null);
    setCopied(null);

    try {
      let brochure:
        | { storage_path: string; filename: string; mime_type: string; size_bytes: number }
        | undefined;

      if (attachmentFile) {
        const validation = validateAttachmentFile(attachmentFile);
        if (validation) throw new Error(validation);
        brochure = await uploadAttachment(user.id, attachmentFile);
      }

      const result = await generateEmailTemplate({
        user_request: userRequest.trim(),
        company_profile: companyProfile.trim(),
        company_website: companyWebsite.trim(),
        length,
        tone,
        brochure,
      });

      loadResult({
        id: result.id,
        subject: result.subject,
        body: result.body,
        editable: true,
      });
      setRewriteLength(length);
      setRewriteTone(tone);
      setUsage(result.usage);
      setAttachmentFile(null);
      await refreshHistory(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      try {
        await refreshUsage();
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false);
    }
  }

  async function openHistoryItem(id: string) {
    setError(null);
    setCopied(null);
    setSaveNotice(null);
    try {
      const { generation } = await fetchEmailTemplate(id);
      const editable = generation.status === "completed" && !!generation.subject && !!generation.body;
      loadResult({
        id: generation.id,
        subject: generation.subject,
        body: generation.body,
        editable,
      });
      if (generation.status === "failed") {
        setError(generation.error_message || "This generation failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load generation");
    }
  }

  async function handleRewrite() {
    if (!resultEditable || !editSubject.trim() || !editBody.trim() || rewriting) return;
    setRewriting(true);
    setError(null);
    setSaveNotice(null);
    try {
      const result = await rewriteEmailTemplate({
        subject: editSubject.trim(),
        body: editBody.trim(),
        length: rewriteLength,
        tone: rewriteTone,
        instruction: rewriteInstruction.trim() || undefined,
      });
      setEditSubject(result.subject);
      setEditBody(result.body);
      setRewriteInstruction("");
      setShowRewriteModal(false);
      setSaveNotice("Rewritten — save to keep changes");
      setTimeout(() => setSaveNotice(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewriting(false);
    }
  }

  async function handleSaveEdits() {
    if (!selectedId || !canSave) return;
    setSaving(true);
    setError(null);
    setSaveNotice(null);
    try {
      const { generation } = await updateEmailTemplate(selectedId, {
        subject: editSubject.trim(),
        body: editBody.trim(),
      });
      loadResult({
        id: generation.id,
        subject: generation.subject,
        body: generation.body,
        editable: true,
      });
      setSaveNotice("Saved");
      setTimeout(() => setSaveNotice(null), 2000);
      await refreshHistory(historyPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save edits");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelEdits() {
    setEditSubject(subject ?? "");
    setEditBody(body ?? "");
    setSaveNotice(null);
  }

  async function copyText(kind: "subject" | "body", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / 10));

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4 email-templates-page">
        <div className="d-flex flex-column flex-md-row align-items-start justify-content-between gap-2 gap-md-3 mb-4">
          <div>
            <h1 className="h4 mb-1">Email Template Generator</h1>
            <p className="text-body-secondary mb-0 small">
              Generate ready-to-use email subject lines and bodies from your company context.
            </p>
          </div>
          <div className="text-start text-md-end">
            {usage?.has_active_period ? (
              <>
                <Badge bg="primary" className="mb-1">
                  {usage.free_remaining} of {usage.free_limit} free remaining
                </Badge>
                <div className="text-body-secondary small">
                  Plan period ends {usage.period_end ? formatWhen(usage.period_end) : "—"}
                  {usage.free_remaining === 0 ? " · further gens cost 1 credit" : ""}
                </div>
              </>
            ) : (
              <>
                <Badge bg="secondary" className="mb-1">
                  1 credit per generation
                </Badge>
                <div className="text-body-secondary small">No active plan — free quota unavailable</div>
              </>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Row className="g-4 align-items-start">
          <Col lg={5}>
            <Card className="shadow-sm border-0 email-templates-card">
              <Card.Body className="p-4">
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span className="email-templates-card-icon" aria-hidden>
                    <EnvelopePaper size={16} />
                  </span>
                  <h2 className="h6 mb-0">Generate</h2>
                </div>

                <Form onSubmit={handleGenerate}>
                  <Form.Group className="mb-3" controlId="userRequest">
                    <Form.Label>
                      What do you want?{" "}
                      {requestRequired && <span className="text-danger">*</span>}
                    </Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={userRequest}
                      onChange={(e) => setUserRequest(e.target.value)}
                      placeholder="e.g. Cold outreach to SaaS founders about our analytics product"
                      disabled={loading}
                      required={requestRequired}
                    />
                    <Form.Text muted>
                      Required only when company profile and website are both empty.
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3" controlId="companyProfile">
                    <Form.Label>Company profile</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={companyProfile}
                      onChange={(e) => setCompanyProfile(e.target.value)}
                      placeholder="What your company does, who you sell to, key differentiators…"
                      disabled={loading}
                    />
                  </Form.Group>

                  <Form.Group className="mb-3" controlId="companyWebsite">
                    <Form.Label>Website URL</Form.Label>
                    <Form.Control
                      type="url"
                      value={companyWebsite}
                      onChange={(e) => setCompanyWebsite(e.target.value)}
                      placeholder="https://example.com"
                      disabled={loading}
                    />
                  </Form.Group>

                  <Row className="g-3 mb-1">
                    <Col sm={7}>
                      <OptionGroup
                        idPrefix="generateLength"
                        label="Length"
                        options={EMAIL_TEMPLATE_LENGTHS}
                        value={length}
                        disabled={loading}
                        onChange={setLength}
                      />
                    </Col>
                    <Col sm={5}>
                      <OptionGroup
                        idPrefix="generateTone"
                        label="Tone"
                        options={EMAIL_TEMPLATE_TONES}
                        value={tone}
                        disabled={loading}
                        onChange={setTone}
                      />
                    </Col>
                  </Row>

                  <Form.Group className="mb-4" controlId="attachment">
                    <Form.Label>Attachments (optional)</Form.Label>
                    <Form.Control
                      type="file"
                      accept=".pdf,application/pdf"
                      disabled={loading}
                      onChange={(e) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0] ?? null;
                        setAttachmentFile(file);
                      }}
                    />
                    <Form.Text muted>PDF only · max 5 MB</Form.Text>
                    {attachmentFile && (
                      <div className="small mt-1 text-body-secondary">{attachmentFile.name}</div>
                    )}
                  </Form.Group>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!canSubmit || loading}
                    className="d-inline-flex align-items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Spinner animation="border" size="sm" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <EnvelopePaper size={16} />
                        Generate template
                      </>
                    )}
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={7}>
            <Card className="shadow-sm border-0 email-templates-card">
              <Card.Body className="p-4">
                <div className="d-flex align-items-center justify-content-between gap-2 mb-3 flex-wrap">
                  <h2 className="h6 mb-0">Result</h2>
                  {resultEditable && !loading && (
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      {saveNotice && <span className="small text-success">{saveNotice}</span>}
                      <Button
                        size="sm"
                        variant="outline-primary"
                        className="d-inline-flex align-items-center gap-1"
                        disabled={
                          rewriting || saving || !editSubject.trim() || !editBody.trim()
                        }
                        onClick={openRewriteModal}
                      >
                        <Stars size={14} />
                        Rewrite with AI
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        disabled={!dirty || saving || rewriting}
                        onClick={handleCancelEdits}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!canSave || saving || rewriting}
                        onClick={handleSaveEdits}
                        className="d-inline-flex align-items-center gap-1"
                      >
                        {saving ? (
                          <>
                            <Spinner animation="border" size="sm" />
                            Saving…
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                {!hasResult && !loading && (
                  <div className="email-templates-empty">
                    <span className="email-templates-empty-icon" aria-hidden>
                      <EnvelopePaper size={22} />
                    </span>
                    <p className="mb-1 fw-medium">No template yet</p>
                    <p className="text-body-secondary small mb-0">
                      Fill in the form and generate — your subject and body will show up here.
                    </p>
                  </div>
                )}

                {loading && (
                  <div className="email-templates-empty">
                    <Spinner animation="border" size="sm" className="mb-2" />
                    <p className="text-body-secondary small mb-0">Working with your provider…</p>
                  </div>
                )}

                {(subject || resultEditable) && !loading && (
                  <div className="mb-3">
                    <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                      <div className="small text-body-secondary">Subject</div>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        className="d-inline-flex align-items-center gap-1"
                        disabled={!editSubject.trim()}
                        onClick={() => copyText("subject", editSubject)}
                      >
                        {copied === "subject" ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
                        Copy
                      </Button>
                    </div>
                    {resultEditable ? (
                      <Form.Control
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        disabled={saving || rewriting}
                        maxLength={300}
                      />
                    ) : (
                      <div className="fw-semibold">{subject}</div>
                    )}
                  </div>
                )}

                {(body || resultEditable) && !loading && (
                  <div>
                    <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                      <div className="small text-body-secondary">Body</div>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        className="d-inline-flex align-items-center gap-1"
                        disabled={!editBody.trim()}
                        onClick={() => copyText("body", editBody)}
                      >
                        {copied === "body" ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}
                        Copy
                      </Button>
                    </div>
                    {resultEditable ? (
                      <Form.Control
                        as="textarea"
                        ref={bodyTextareaRef}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        disabled={saving || rewriting}
                        className="email-template-body-editor"
                        style={{
                          fontFamily: "inherit",
                          whiteSpace: "pre-wrap",
                          minHeight: BODY_TEXTAREA_MIN_PX,
                          overflow: "hidden",
                          resize: "vertical",
                          lineHeight: 1.55,
                        }}
                      />
                    ) : (
                      <pre
                        className="mb-0 p-3 bg-body-tertiary rounded small"
                        style={{
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          lineHeight: 1.55,
                        }}
                      >
                        {body}
                      </pre>
                    )}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card className="shadow-sm border-0 email-templates-card mt-4">
          <Card.Body className="p-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0">History</h2>
              {historyLoading && <Spinner animation="border" size="sm" />}
            </div>

            {history.length === 0 && !historyLoading ? (
              <p className="text-body-secondary small mb-0">No generations yet.</p>
            ) : (
              <>
                <Table hover responsive size="sm" className="mb-2 align-middle email-templates-history">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Request</th>
                      <th>Subject</th>
                      <th>Status</th>
                      <th>Billing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr
                        key={row.id}
                        role="button"
                        className={selectedId === row.id ? "table-active" : undefined}
                        onClick={() => openHistoryItem(row.id)}
                      >
                        <td className="text-nowrap small">{formatWhen(row.created_at)}</td>
                        <td className="small">{preview(row.user_request || row.company_profile)}</td>
                        <td className="small">{preview(row.subject)}</td>
                        <td>
                          <Badge
                            bg={
                              row.status === "completed"
                                ? "success"
                                : row.status === "failed"
                                  ? "danger"
                                  : "secondary"
                            }
                          >
                            {row.status}
                          </Badge>
                        </td>
                        <td className="small">
                          {row.billing_type === "free"
                            ? "Free"
                            : row.billing_type === "credit"
                              ? `${row.credits_charged || 1} credit`
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {totalPages > 1 && (
                  <div className="d-flex justify-content-between align-items-center">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      disabled={historyPage <= 1 || historyLoading}
                      onClick={() => refreshHistory(historyPage - 1)}
                    >
                      Previous
                    </Button>
                    <span className="small text-body-secondary">
                      Page {historyPage} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      disabled={historyPage >= totalPages || historyLoading}
                      onClick={() => refreshHistory(historyPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card.Body>
        </Card>
      </Container>

      <Modal show={showRewriteModal} onHide={closeRewriteModal} centered>
        <Modal.Header closeButton={!rewriting}>
          <Modal.Title className="h6 mb-0 d-flex align-items-center gap-2">
            <Stars size={16} className="text-primary" />
            Rewrite with AI
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-body-secondary small mb-3">
            Optionally describe what to change, pick length and tone, then rewrite the current
            editor text. Free — does not use credits or free quota.
          </p>
          <Form.Group className="mb-3" controlId="rewriteInstruction">
            <Form.Label className="small fw-medium text-body-secondary mb-2">
              What should change? <span className="fw-normal">(optional)</span>
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={rewriteInstruction}
              onChange={(e) => setRewriteInstruction(e.target.value.slice(0, 2000))}
              disabled={rewriting}
              placeholder="e.g. Make the CTA softer, mention our free trial, shorten the opening…"
              maxLength={2000}
            />
          </Form.Group>
          <OptionGroup
            idPrefix="rewriteLength"
            label="Length"
            options={EMAIL_TEMPLATE_LENGTHS}
            value={rewriteLength}
            disabled={rewriting}
            onChange={setRewriteLength}
          />
          <OptionGroup
            idPrefix="rewriteTone"
            label="Tone"
            options={EMAIL_TEMPLATE_TONES}
            value={rewriteTone}
            disabled={rewriting}
            onChange={setRewriteTone}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={closeRewriteModal}
            disabled={rewriting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={rewriting || !editSubject.trim() || !editBody.trim()}
            onClick={handleRewrite}
            className="d-inline-flex align-items-center gap-2"
          >
            {rewriting ? (
              <>
                <Spinner animation="border" size="sm" />
                Rewriting…
              </>
            ) : (
              <>
                <Stars size={14} />
                Rewrite
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </AppLayout>
  );
}
