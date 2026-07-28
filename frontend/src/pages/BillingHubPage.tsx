import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Col, Container, Nav, Row, Spinner, Table } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import BillingDetailsForm, { type BillingProfile } from "../components/BillingDetailsForm";
import { apiGet } from "../lib/api";
import { formatMoney } from "../lib/formatMoney";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";

type HubTab = "invoices" | "details" | "plan";
type DocFilter = "all" | "paid" | "due" | "past_due";

interface InvoiceListItem {
  id: string;
  invoice_number: string;
  receipt_number: string | null;
  invoice_date: string;
  issued_at: string;
  status: string;
  document_type: string;
  total_minor: number;
  currency: string;
  due_date: string | null;
  line_items: Array<{ description?: string; name?: string; credits?: number }> | null;
}

interface SubscriptionInfo {
  id: string;
  plan_id: string;
  plan: { id: string; name: string; credits: number; total_minor_units: number; currency: string } | null;
  status: string;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string;
  pending_plan_id: string | null;
  pending_plan: { id: string; name: string; credits: number } | null;
  proforma: { id: string; invoice_number: string; status: string; due_date: string | null } | null;
}

type UiStatus = "paid" | "payment_due" | "past_due" | "void";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  business: "Business",
};

function descriptionFromInvoice(inv: InvoiceListItem): string {
  const li = inv.line_items?.[0];
  if (li?.description) return li.description;
  if (li?.name) return li.name;
  if (inv.document_type === "proforma_invoice") return "Pro forma — plan renewal";
  return "Monthly plan";
}

function resolveUiStatus(inv: InvoiceListItem, subStatus: string | null): UiStatus {
  if (inv.document_type === "proforma_invoice") {
    if (inv.status === "paid") return "paid";
    if (inv.status === "void" || inv.status === "cancelled") return "void";
    if (subStatus === "past_due" || subStatus === "expired") return "past_due";
    return "payment_due";
  }
  if (inv.status === "cancelled" || inv.status === "void") return "void";
  return "paid";
}

function statusBadge(status: UiStatus) {
  switch (status) {
    case "paid":
      return <Badge bg="success">Paid</Badge>;
    case "payment_due":
      return <Badge bg="warning" text="dark">Payment due</Badge>;
    case "past_due":
      return <Badge bg="danger">Past due</Badge>;
    case "void":
      return <Badge bg="secondary">Void</Badge>;
  }
}

export default function BillingHubPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: HubTab = tabParam === "details" || tabParam === "plan" ? tabParam : "invoices";

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [filter, setFilter] = useState<DocFilter>("all");
  const [loadingSub, setLoadingSub] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [billingSaved, setBillingSaved] = useState(false);

  const [summary, setSummary] = useState<{
    totalSpentMinorUnits: number;
    creditsPurchased: number;
    successCount: number;
    lastPaymentAt: string | null;
  } | null>(null);

  const setTab = useCallback(
    (next: HubTab) => {
      if (next === "invoices") {
        setSearchParams({}, { replace: true });
      } else {
        setSearchParams({ tab: next }, { replace: true });
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    let active = true;
    setLoadingSub(true);
    apiGet<{ subscription: SubscriptionInfo | null }>("/api/billing/subscription")
      .then(async (res) => {
        if (!active) return;
        setSubscription(res.subscription);
        // ensureSubscription may just have created a pro forma — refresh invoices.
        try {
          const invRes = await apiGet<{ invoices: InvoiceListItem[] }>("/api/invoices?limit=50");
          if (!active) return;
          setInvoices(invRes.invoices ?? []);
          setLoadingInvoices(false);
        } catch {
          /* invoices effect may still load */
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load subscription");
      })
      .finally(() => {
        if (active) setLoadingSub(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingInvoices(true);
    apiGet<{ invoices: InvoiceListItem[] }>("/api/invoices?limit=50")
      .then((res) => {
        if (!active) return;
        setInvoices(res.invoices ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load invoices");
      })
      .finally(() => {
        if (active) setLoadingInvoices(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("payments")
      .select("amount_minor_units, credits_promised, created_at, status")
      .eq("user_id", user.id)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!active || !data) return;
        setSummary({
          totalSpentMinorUnits: data.reduce((sum, r) => sum + (r.amount_minor_units ?? 0), 0),
          creditsPurchased: data.reduce((sum, r) => sum + (r.credits_promised ?? 0), 0),
          successCount: data.length,
          lastPaymentAt: data[0]?.created_at ?? null,
        });
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (tab !== "details") return;
    let active = true;
    setLoadingBilling(true);
    apiGet<{ profile: BillingProfile | null }>("/api/billing/profile")
      .then((res) => {
        if (!active) return;
        setBillingProfile(res.profile);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load billing details");
      })
      .finally(() => {
        if (active) setLoadingBilling(false);
      });
    return () => {
      active = false;
    };
  }, [tab]);

  const subStatus = subscription?.status ?? null;

  const rows = useMemo(() => {
    return invoices
      .filter(
        (inv) =>
          !(
            inv.document_type === "proforma_invoice" &&
            (inv.status === "void" || inv.status === "cancelled" || inv.status === "paid")
          ),
      )
      .map((inv) => ({
        inv,
        uiStatus: resolveUiStatus(inv, subStatus),
      }))
      .filter(({ uiStatus }) => {
        if (filter === "all") return true;
        if (filter === "paid") return uiStatus === "paid";
        if (filter === "due") return uiStatus === "payment_due";
        if (filter === "past_due") return uiStatus === "past_due";
        return true;
      });
  }, [invoices, subStatus, filter]);

  const showPastDueBanner = Boolean(
    subscription &&
      (subscription.status === "past_due" ||
        subscription.status === "expired" ||
        subscription.proforma?.status === "issued"),
  );

  const bannerIsPastDue = subscription?.status === "past_due" || subscription?.status === "expired";

  const payNowTo = subscription?.proforma?.id
    ? `/billing/documents/${subscription.proforma.id}`
    : "/buy-credits";

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
          <div>
            <h1 className="h4 mb-0 text-primary">Billing</h1>
            <p className="text-body-secondary small mb-0">Plan, invoices, receipts, and billing details in one place.</p>
          </div>
          <Link to="/buy-credits" className="btn btn-primary btn-sm">
            {subscription ? "Renew / change plan" : "View plans"}
          </Link>
        </div>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {showPastDueBanner && (
          <Alert variant={bannerIsPastDue ? "danger" : "warning"} className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div>
              {bannerIsPastDue ? (
                <>
                  Your payment is <strong>past due</strong>. Renew to keep access and roll over unused credits (same plan or
                  upgrade).
                </>
              ) : (
                <>
                  A renewal payment is <strong>due soon</strong>. Pay now to continue your plan without interruption.
                </>
              )}
            </div>
            <Link to={payNowTo} className="btn btn-sm btn-dark">
              Pay now
            </Link>
          </Alert>
        )}

        <Nav variant="tabs" className="mb-4">
          <Nav.Item>
            <Nav.Link active={tab === "invoices"} onClick={() => setTab("invoices")} role="button">
              Invoices
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link active={tab === "details"} onClick={() => setTab("details")} role="button">
              Billing details
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link active={tab === "plan"} onClick={() => setTab("plan")} role="button">
              Plan
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {tab === "invoices" && (
          <>
            <Row className="g-3 mb-4">
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100 border-0">
                  <Card.Body>
                    <div className="text-body-secondary small">Total spent</div>
                    <div className="h5 mb-0">
                      {summary ? formatMoney(summary.totalSpentMinorUnits, "INR") : <Spinner animation="border" size="sm" />}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100 border-0">
                  <Card.Body>
                    <div className="text-body-secondary small">Credits purchased</div>
                    <div className="h5 mb-0">
                      {summary ? summary.creditsPurchased.toLocaleString() : <Spinner animation="border" size="sm" />}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100 border-0">
                  <Card.Body>
                    <div className="text-body-secondary small">Successful payments</div>
                    <div className="h5 mb-0">{summary ? summary.successCount : <Spinner animation="border" size="sm" />}</div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100 border-0">
                  <Card.Body>
                    <div className="text-body-secondary small">Last payment</div>
                    <div className="h6 mb-0">
                      {!summary ? (
                        <Spinner animation="border" size="sm" />
                      ) : summary.lastPaymentAt ? (
                        new Date(summary.lastPaymentAt).toLocaleDateString("en-IN")
                      ) : (
                        "—"
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Card className="shadow-sm border-0">
              <Card.Body>
                <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                  <h2 className="h6 mb-0">Invoices & receipts</h2>
                  <div className="btn-group btn-group-sm">
                    {(
                      [
                        ["all", "All"],
                        ["paid", "Paid"],
                        ["due", "Payment due"],
                        ["past_due", "Past due"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        variant={filter === value ? "primary" : "outline-primary"}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {loadingInvoices ? (
                  <div className="text-center py-4">
                    <Spinner animation="border" size="sm" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="text-body-secondary small mb-0">No documents yet. Subscribe from Plans to get started.</p>
                ) : (
                  <div className="table-responsive">
                    <Table hover className="align-middle mb-0">
                      <thead>
                        <tr className="small text-body-secondary">
                          <th>Date</th>
                          <th>Description</th>
                          <th className="text-end">Amount</th>
                          <th>Status</th>
                          <th className="text-end">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ inv, uiStatus }) => (
                          <tr key={inv.id}>
                            <td className="small">
                              {new Date(inv.invoice_date || inv.issued_at).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td>
                              <div className="small fw-medium">{descriptionFromInvoice(inv)}</div>
                              <div className="text-body-secondary small font-monospace">{inv.invoice_number}</div>
                            </td>
                            <td className="text-end small">{formatMoney(inv.total_minor, inv.currency)}</td>
                            <td>{statusBadge(uiStatus)}</td>
                            <td className="text-end">
                              <div className="d-inline-flex gap-2">
                                {(uiStatus === "payment_due" || uiStatus === "past_due") && (
                                  <Link to="/buy-credits" className="btn btn-sm btn-outline-danger">
                                    Pay now
                                  </Link>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => navigate(`/billing/documents/${inv.id}`)}
                                >
                                  Details
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card.Body>
            </Card>
          </>
        )}

        {tab === "details" && (
          <Card className="shadow-sm border-0" style={{ maxWidth: 720 }}>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <h2 className="h6 mb-1">Billing details</h2>
                  <p className="text-body-secondary small mb-0">
                    Used on future invoices. Changing these does not alter documents already issued.
                  </p>
                </div>
              </div>
              {billingSaved && (
                <Alert variant="success" dismissible onClose={() => setBillingSaved(false)}>
                  Billing details saved.
                </Alert>
              )}
              {loadingBilling ? (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" />
                </div>
              ) : (
                <BillingDetailsForm
                  initial={billingProfile}
                  onSaved={(next) => {
                    setBillingProfile(next);
                    setBillingSaved(true);
                  }}
                />
              )}
              <hr className="my-4" />
              <div>
                <h3 className="h6">Payment method</h3>
                <p className="text-body-secondary small mb-0">
                  Payments are collected securely via Razorpay at checkout each month. We do not store your card on file —
                  you choose UPI, card, or netbanking when you renew.
                </p>
              </div>
            </Card.Body>
          </Card>
        )}

        {tab === "plan" && (
          <Card className="shadow-sm border-0" style={{ maxWidth: 640 }}>
            <Card.Body>
              {loadingSub ? (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" />
                </div>
              ) : !subscription ? (
                <>
                  <h2 className="h6 mb-2">No active plan</h2>
                  <p className="text-body-secondary small">
                    Subscribe to a monthly plan to get credits every month. Unused credits roll over on renew or upgrade.
                  </p>
                  <Link to="/buy-credits" className="btn btn-primary btn-sm">
                    View plans
                  </Link>
                </>
              ) : (
                <>
                  <div className="d-flex justify-content-between align-items-start mb-3">
                    <div>
                      <h2 className="h6 mb-1">Current plan</h2>
                      <div className="h5 mb-0">
                        {PLAN_LABELS[subscription.plan_id] ?? subscription.plan?.name ?? subscription.plan_id}
                      </div>
                    </div>
                    <Badge
                      bg={
                        subscription.status === "active"
                          ? "success"
                          : subscription.status === "past_due"
                            ? "danger"
                            : "secondary"
                      }
                    >
                      {subscription.status}
                    </Badge>
                  </div>
                  <dl className="row small mb-3">
                    <dt className="col-sm-4 text-body-secondary">Monthly credits</dt>
                    <dd className="col-sm-8">{subscription.plan?.credits?.toLocaleString() ?? "—"}</dd>
                    <dt className="col-sm-4 text-body-secondary">Period ends</dt>
                    <dd className="col-sm-8">
                      {new Date(subscription.current_period_end).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </dd>
                    <dt className="col-sm-4 text-body-secondary">Buffer until</dt>
                    <dd className="col-sm-8">
                      {new Date(subscription.grace_ends_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </dd>
                    {subscription.proforma && (
                      <>
                        <dt className="col-sm-4 text-body-secondary">Pro forma</dt>
                        <dd className="col-sm-8">
                          <Link to={`/billing/documents/${subscription.proforma.id}`}>
                            {subscription.proforma.invoice_number}
                          </Link>
                          {subscription.proforma.status === "issued" && (
                            <Badge bg="warning" text="dark" className="ms-2">
                              Unpaid
                            </Badge>
                          )}
                        </dd>
                      </>
                    )}
                  </dl>
                  <div className="d-flex flex-wrap gap-2">
                    <Link to="/buy-credits" className="btn btn-primary btn-sm">
                      Renew / change plan
                    </Link>
                    {subscription.proforma && (
                      <Link to={`/billing/documents/${subscription.proforma.id}`} className="btn btn-outline-primary btn-sm">
                        View pro forma
                      </Link>
                    )}
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        )}
      </Container>
    </AppLayout>
  );
}
