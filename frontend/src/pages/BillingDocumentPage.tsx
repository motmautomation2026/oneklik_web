import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Col, Container, Row, Spinner } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import { apiGet, apiGetText } from "../lib/api";
import { formatMoney } from "../lib/formatMoney";

interface InvoiceDetail {
  id: string;
  invoice_number: string;
  receipt_number: string | null;
  invoice_date: string;
  issued_at: string;
  due_date: string | null;
  status: string;
  document_type: string;
  total_minor: number;
  taxable_value_minor: number;
  currency: string;
  line_items: Array<{ description?: string; name?: string; credits?: number }> | null;
  payment_snapshot: Record<string, unknown> | null;
  related_tax_invoice_id?: string | null;
}

interface SubscriptionInfo {
  status: string;
  proforma: { id: string; status: string } | null;
}

function paymentMethodLabel(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "—";
  const method = typeof snapshot.method === "string" ? snapshot.method.toLowerCase() : "";
  if (method === "upi") return "UPI / Razorpay";
  if (method === "card") {
    const last4 = typeof snapshot.card_last4 === "string" ? snapshot.card_last4 : null;
    const network = typeof snapshot.card_network === "string" ? snapshot.card_network : "Card";
    return last4 ? `${network} •••• ${last4}` : `${network} / Razorpay`;
  }
  if (method === "netbanking") return "Netbanking / Razorpay";
  if (method) return `${method} / Razorpay`;
  if (snapshot.razorpay_payment_id) return "Razorpay";
  return "—";
}

export default function BillingDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    Promise.all([
      apiGet<{ invoice: InvoiceDetail }>(`/api/invoices/${id}`),
      apiGet<{ subscription: SubscriptionInfo | null }>("/api/billing/subscription").catch(() => ({
        subscription: null,
      })),
    ])
      .then(([invRes, subRes]) => {
        if (!active) return;
        const inv = invRes.invoice;
        // Superseded proforma → show the paid tax invoice / receipt instead.
        if (
          inv.document_type === "proforma_invoice" &&
          (inv.status === "void" || inv.status === "cancelled" || inv.status === "paid") &&
          inv.related_tax_invoice_id
        ) {
          navigate(`/billing/documents/${inv.related_tax_invoice_id}`, { replace: true });
          return;
        }
        setInvoice(inv);
        setSubStatus(subRes.subscription?.status ?? null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load document");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, navigate]);

  const isProforma = invoice?.document_type === "proforma_invoice";
  const isVoid =
    invoice?.status === "void" || invoice?.status === "cancelled";
  const unpaid = Boolean(isProforma && invoice?.status === "issued");
  const pastDue = unpaid && (subStatus === "past_due" || subStatus === "expired");
  const isPaid =
    Boolean(invoice) &&
    !isVoid &&
    (invoice!.status === "paid" || (!isProforma && invoice!.status === "issued"));

  const heroTitle = useMemo(() => {
    if (!invoice) return "";
    if (isVoid) return isProforma ? "Pro forma void" : "Invoice cancelled";
    if (isProforma && unpaid) return pastDue ? "Payment past due" : "Payment due";
    if (isProforma && invoice.status === "paid") return "Pro forma paid";
    return "Payment received";
  }, [invoice, isProforma, unpaid, pastDue, isVoid]);

  const statusBadge = useMemo(() => {
    if (isVoid) {
      return <Badge bg="secondary">Void</Badge>;
    }
    if (unpaid) {
      return (
        <Badge bg={pastDue ? "danger" : "warning"} text={pastDue ? undefined : "dark"}>
          {pastDue ? "Past due" : "Payment due"}
        </Badge>
      );
    }
    if (isPaid) {
      return <Badge bg="success">Paid</Badge>;
    }
    return <Badge bg="secondary">{invoice?.status ?? "Unknown"}</Badge>;
  }, [isVoid, unpaid, pastDue, isPaid, invoice?.status]);

  const description = useMemo(() => {
    if (!invoice) return "";
    const li = invoice.line_items?.[0];
    if (li?.description) return li.description;
    if (li?.name) return li.name;
    return isProforma ? "Pro forma — plan renewal" : "Monthly plan";
  }, [invoice, isProforma]);

  type DocumentView = "proforma" | "receipt" | "invoice";

  async function downloadPdf(view?: DocumentView) {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const qs = view ? `?view=${view}` : "";
      const res = await apiGet<{ url: string; filename: string }>(`/api/invoices/${invoice.id}/pdf${qs}`);
      const a = document.createElement("a");
      a.href = res.url;
      a.download = res.filename || `${invoice.invoice_number}.pdf`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PDF");
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview(view?: DocumentView) {
    if (!invoice) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const qs = view ? `?view=${view}` : "";
      const html = await apiGetText(`/api/invoices/${invoice.id}/html${qs}`);
      setPreviewHtml(html);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4" style={{ maxWidth: 720 }}>
        <Button variant="link" className="px-0 mb-3 text-decoration-none" onClick={() => navigate("/billing")}>
          ← Back to Billing
        </Button>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        ) : !invoice ? (
          <Alert variant="warning">Document not found.</Alert>
        ) : (
          <>
            <Card className="shadow-sm border-0 mb-4">
              <Card.Body className="p-4 text-center">
                <div className="mb-2">{statusBadge}</div>
                <h1 className="h4 text-body-secondary mb-2">{heroTitle}</h1>
                <div className="display-6 fw-semibold mb-3">{formatMoney(invoice.total_minor, invoice.currency)}</div>
                <p className="text-body-secondary small mb-0">{description}</p>
              </Card.Body>
            </Card>

            <Card className="shadow-sm border-0 mb-4">
              <Card.Body className="p-4">
                <Row className="gy-3 small">
                  <Col sm={6}>
                    <div className="text-body-secondary">Invoice number</div>
                    <div className="font-monospace fw-medium">{invoice.invoice_number}</div>
                  </Col>
                  {!isProforma && invoice.receipt_number && (
                    <Col sm={6}>
                      <div className="text-body-secondary">Receipt number</div>
                      <div className="font-monospace fw-medium">{invoice.receipt_number}</div>
                    </Col>
                  )}
                  <Col sm={6}>
                    <div className="text-body-secondary">{isProforma ? "Date issued" : "Date paid"}</div>
                    <div>
                      {new Date(invoice.invoice_date || invoice.issued_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  </Col>
                  {invoice.due_date && unpaid && (
                    <Col sm={6}>
                      <div className="text-body-secondary">Payment due</div>
                      <div>
                        {new Date(`${invoice.due_date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </div>
                    </Col>
                  )}
                  {!isProforma && (
                    <Col sm={6}>
                      <div className="text-body-secondary">Payment method</div>
                      <div>{paymentMethodLabel(invoice.payment_snapshot)}</div>
                    </Col>
                  )}
                </Row>
              </Card.Body>
            </Card>

            <div className="d-flex flex-wrap gap-2 mb-4">
              {unpaid ? (
                <>
                  <Link to="/buy-credits" className="btn btn-primary">
                    Pay now
                  </Link>
                  <Button variant="outline-primary" disabled={busy} onClick={() => void downloadPdf("proforma")}>
                    {busy ? "…" : "Download pro forma"}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    disabled={previewLoading}
                    onClick={() => void loadPreview("proforma")}
                  >
                    {previewLoading ? "Loading…" : previewHtml ? "Refresh preview" : "Preview"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void downloadPdf("invoice")}>
                    {busy ? "…" : "Download invoice"}
                  </Button>
                  <Button
                    variant="outline-primary"
                    disabled={previewLoading}
                    onClick={() => void loadPreview("invoice")}
                  >
                    {previewLoading ? "Loading…" : "Preview invoice"}
                  </Button>
                  <Button variant="outline-secondary" disabled={busy} onClick={() => void downloadPdf("receipt")}>
                    {busy ? "…" : "Download receipt"}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    disabled={previewLoading}
                    onClick={() => void loadPreview("receipt")}
                  >
                    {previewLoading ? "Loading…" : "Preview receipt"}
                  </Button>
                </>
              )}
            </div>

            {previewHtml && (
              <Card className="shadow-sm border-0 overflow-hidden">
                <Card.Header className="bg-white small fw-medium">Document preview</Card.Header>
                <Card.Body className="p-0">
                  <iframe
                    title={invoice.invoice_number}
                    srcDoc={previewHtml}
                    sandbox=""
                    style={{ width: "100%", minHeight: "70vh", border: 0, background: "#fff" }}
                  />
                </Card.Body>
              </Card>
            )}
          </>
        )}
      </Container>
    </AppLayout>
  );
}
