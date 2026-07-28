import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Modal,
  OverlayTrigger,
  Row,
  Spinner,
  Tooltip,
} from "react-bootstrap";
import { CheckCircleFill, InfoCircle } from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import BillingDetailsForm, { type BillingProfile } from "../components/BillingDetailsForm";
import { apiGet, apiPost } from "../lib/api";
import { formatMoney, taxPercentLabel } from "../lib/formatMoney";

interface CreditPack {
  id: string;
  name: string;
  credits: number;
  currency: string;
  comingSoon: boolean;
  price_minor_units: number;
  tax_rate_bps: number;
  tax_minor_units: number;
  total_minor_units: number;
  /** Kept for older clients; prefer price_minor_units. */
  priceInr?: number;
}

interface CheckoutResponse {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
}

interface PaymentStatus {
  id: string;
  status: "initiated" | "pending" | "success" | "failed";
  credits_promised: number;
  invoice_id?: string | null;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
const SALES_EMAIL = "sales@oneklik.com";

const PLAN_INFO: Record<string, { label: string; bestFor: string }> = {
  starter: { label: "Starter", bestFor: "Individual users" },
  growth: { label: "Growth", bestFor: "Small teams" },
  business: { label: "Business", bestFor: "Growing businesses" },
};

const PLAN_BILLING_POINTS = [
  "Billed monthly",
  "Credits after payment confirmation",
  "Rollover on renew or upgrade — not on downgrade",
  "3-day grace after the due date",
];

const PLAN_FEATURES = [
  "Company & People Search",
  "Email & Phone Reveal",
  "LinkedIn Lookup",
  "AI-powered search",
  "Save to Lists & export",
];

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay checkout")));
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

export default function BuyCreditsPage() {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ credits: number; invoiceId?: string | null } | null>(null);
  const [billingComplete, setBillingComplete] = useState(false);
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [pendingPack, setPendingPack] = useState<CreditPack | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [subscription, setSubscription] = useState<{
    plan_id: string;
    status: string;
    current_period_end: string;
    grace_ends_at: string;
    pending_plan_id: string | null;
    proforma: { id: string; invoice_number: string; status: string; due_date: string | null } | null;
  } | null>(null);

  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(SALES_EMAIL);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable — email is already shown as plain text.
    }
  }

  useEffect(() => {
    Promise.all([
      apiGet<{ packs: CreditPack[] }>("/api/payments/packs"),
      apiGet<{ profile: BillingProfile | null; complete: boolean }>("/api/billing/profile"),
      apiGet<{
        subscription: {
          plan_id: string;
          status: string;
          current_period_end: string;
          grace_ends_at: string;
          pending_plan_id: string | null;
          proforma: { id: string; invoice_number: string; status: string; due_date: string | null } | null;
        } | null;
      }>("/api/billing/subscription").catch(() => ({ subscription: null })),
    ])
      .then(([packsRes, billingRes, subRes]) => {
        setPacks(packsRes.packs);
        setBillingComplete(billingRes.complete);
        setBillingProfile(billingRes.profile);
        setSubscription(subRes.subscription);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load credit packs"))
      .finally(() => setLoadingPacks(false));
  }, []);

  async function pollStatus(paymentId: string, creditsPromised: number) {
    setPolling(true);
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await apiGet<PaymentStatus>(`/api/payments/${paymentId}/status`);
        if (status.status === "success") {
          setResult({ credits: creditsPromised, invoiceId: status.invoice_id });
          setPolling(false);
          return;
        }
        if (status.status === "failed") {
          setError("Payment failed — no credits were added.");
          setPolling(false);
          return;
        }
      } catch {
        // keep polling
      }
    }
    setPolling(false);
    setError("Still waiting on confirmation from the payment gateway — check Billing shortly.");
  }

  async function startCheckout(pack: CreditPack) {
    setError(null);
    setResult(null);
    setBuyingPackId(pack.id);
    try {
      await loadRazorpayScript();
      const checkout = await apiPost<CheckoutResponse>("/api/payments/checkout", { pack_id: pack.id });

      const razorpay = new window.Razorpay({
        key: checkout.key_id,
        amount: checkout.amount,
        currency: checkout.currency,
        order_id: checkout.order_id,
        name: "One-Klik",
        description: `${pack.credits.toLocaleString()} credits`,
        prefill: checkout.prefill ?? {},
        // Client handler is never trusted as proof of payment — polling only.
        handler: () => pollStatus(checkout.payment_id, pack.credits),
        modal: {
          ondismiss: () => setBuyingPackId(null),
        },
        theme: { color: "#563da4" },
      });
      razorpay.open();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start checkout";
      if (message.toLowerCase().includes("billing details")) {
        setPendingPack(pack);
        setShowBillingModal(true);
      } else {
        setError(message);
      }
    } finally {
      setBuyingPackId(null);
    }
  }

  function handleBuy(pack: CreditPack) {
    if (!billingComplete) {
      setPendingPack(pack);
      setShowBillingModal(true);
      return;
    }
    void startCheckout(pack);
  }

  function onBillingSaved(profile: BillingProfile) {
    setBillingProfile(profile);
    setBillingComplete(true);
    setShowBillingModal(false);
    const pack = pendingPack;
    setPendingPack(null);
    if (pack) void startCheckout(pack);
  }

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">Monthly Plans</h1>

        {subscription && (
          <Alert
            variant={subscription.status === "past_due" || subscription.status === "expired" ? "danger" : "info"}
            className="mb-4"
          >
            <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
              <div>
                <div className="fw-semibold mb-1">
                  Current plan: {PLAN_INFO[subscription.plan_id]?.label ?? subscription.plan_id}{" "}
                  <Badge
                    bg={
                      subscription.status === "past_due" || subscription.status === "expired"
                        ? "danger"
                        : "secondary"
                    }
                    className="ms-1"
                  >
                    {subscription.status}
                  </Badge>
                </div>
                <div className="small">
                  Period ends {new Date(subscription.current_period_end).toLocaleDateString("en-IN")} · Grace until{" "}
                  {new Date(subscription.grace_ends_at).toLocaleDateString("en-IN")}
                  {subscription.proforma ? (
                    <>
                      {" "}
                      · Pro forma {subscription.proforma.invoice_number} ({subscription.proforma.status})
                    </>
                  ) : null}
                </div>
                <div className="small text-body-secondary mt-1">
                  {subscription.status === "past_due" || subscription.status === "expired"
                    ? "Renew your plan below to continue. Same plan or upgrade keeps leftover credits; downgrade does not."
                    : "Choose a plan below to renew. Same plan or upgrade keeps leftover credits; downgrade does not."}
                </div>
              </div>
              {(subscription.status === "past_due" ||
                subscription.status === "expired" ||
                subscription.proforma?.status === "issued") && (
                <div className="d-flex flex-wrap gap-2">
                  {subscription.proforma?.id && (
                    <Link
                      to={`/billing/documents/${subscription.proforma.id}`}
                      className="btn btn-sm btn-outline-dark"
                    >
                      View pro forma
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="dark"
                    disabled={buyingPackId !== null || polling || packs.length === 0}
                    onClick={() => {
                      const pack = packs.find((p) => p.id === (subscription.pending_plan_id || subscription.plan_id));
                      if (pack) handleBuy(pack);
                      else setError("Could not find your plan to renew — pick a plan card below.");
                    }}
                  >
                    Pay now — renew
                  </Button>
                </div>
              )}
            </div>
          </Alert>
        )}

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {result && (
          <Alert variant="success" dismissible onClose={() => setResult(null)}>
            Payment confirmed — {result.credits.toLocaleString()} credits added to your account.
            {result.invoiceId ? (
              <>
                {" "}
                Your receipt is ready in <Link to="/billing">Billing</Link>.
              </>
            ) : (
              ""
            )}
          </Alert>
        )}
        {polling && (
          <Alert variant="info">
            <Spinner animation="border" size="sm" className="me-2" />
            Waiting for payment confirmation…
          </Alert>
        )}

        {loadingPacks ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        ) : (
          <Row className="g-4">
            {packs.map((pack) => {
              const info = PLAN_INFO[pack.id];
              return (
                <Col xs={12} md={6} lg={3} key={pack.id}>
                  <Card className={`shadow-sm h-100 ${pack.comingSoon ? "opacity-75" : ""}`}>
                    <Card.Body className="d-flex flex-column">
                      {pack.comingSoon ? (
                        <>
                          <Badge bg="secondary" className="mb-3 align-self-start">
                            Coming soon
                          </Badge>
                          <h2 className="h5">More pack sizes</h2>
                          <p className="text-body-secondary small flex-grow-1">
                            Additional credit packs will be available here soon.
                          </p>
                          <Button variant="outline-secondary" disabled className="w-100">
                            Not available yet
                          </Button>
                        </>
                      ) : (
                        <>
                          {info && (
                            <Badge bg="secondary" className="mb-3 align-self-start">
                              {info.label}
                            </Badge>
                          )}
                          <h2 className="h5">{pack.credits.toLocaleString()} credits</h2>
                          {info && (
                            <p className="text-body-secondary small mb-2">Best for {info.bestFor.toLowerCase()}.</p>
                          )}
                          <div className="mb-3">
                            <div className="h3 mb-1 d-flex align-items-center gap-2">
                              {formatMoney(pack.price_minor_units, pack.currency)}
                              <OverlayTrigger
                                placement="top"
                                overlay={
                                  <Tooltip>
                                    <div>2 credits per email</div>
                                    <div>20 credits per contact</div>
                                  </Tooltip>
                                }
                              >
                                <InfoCircle
                                  size={14}
                                  className="text-body-secondary"
                                  style={{ cursor: "help" }}
                                />
                              </OverlayTrigger>
                            </div>
                            <div className="text-body-secondary small">
                              + {taxPercentLabel(pack.tax_rate_bps)} GST
                            </div>
                          </div>
                          <ul className="list-unstyled small mb-3 flex-grow-1">
                            {[...PLAN_BILLING_POINTS, ...PLAN_FEATURES].map((feature) => (
                              <li key={feature} className="d-flex align-items-start gap-2 mb-1">
                                <CheckCircleFill className="text-primary flex-shrink-0 mt-1" size={14} />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                          <Button
                            variant="primary"
                            className="w-100"
                            disabled={buyingPackId === pack.id || polling}
                            onClick={() => handleBuy(pack)}
                          >
                            {buyingPackId === pack.id ? (
                              <>
                                <Spinner animation="border" size="sm" className="me-2" />
                                Opening checkout…
                              </>
                            ) : subscription ? (
                              subscription.plan_id === pack.id ? "Renew plan" : "Switch & pay"
                            ) : (
                              "Subscribe"
                            )}
                          </Button>
                        </>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
            <Col xs={12} md={6} lg={3}>
              <Card className="shadow-sm h-100">
                <Card.Body className="d-flex flex-column">
                  <Badge bg="secondary" className="mb-3 align-self-start">
                    Custom
                  </Badge>
                  <h2 className="h5">Enterprise</h2>
                  <p className="text-body-secondary small flex-grow-1">
                    Custom credit volume for large organizations. Get in touch to set up a plan.
                  </p>
                  <ul className="list-unstyled small mb-3">
                    {[...PLAN_FEATURES, "Custom credit volume", "Priority support"].map((feature) => (
                      <li key={feature} className="d-flex align-items-center gap-2 mb-1">
                        <CheckCircleFill className="text-primary flex-shrink-0" size={14} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="outline-primary"
                    className="w-100"
                    href={`mailto:${SALES_EMAIL}?subject=One-Klik%20Enterprise%20plan`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Contact Sales
                  </Button>
                  <div className="d-flex align-items-center justify-content-center gap-2 mt-2">
                    <span className="text-body-secondary small">{SALES_EMAIL}</span>
                    <Button variant="link" size="sm" className="p-0" onClick={handleCopyEmail}>
                      {emailCopied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        )}
      </Container>

      <Modal show={showBillingModal} onHide={() => setShowBillingModal(false)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Billing details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-body-secondary small">
            Needed once for your receipt. State decides CGST+SGST vs IGST. You can edit these later under
            Billing.
          </p>
          <BillingDetailsForm
            initial={billingProfile}
            submitLabel="Save and continue to payment"
            onSaved={onBillingSaved}
            onCancel={() => {
              setShowBillingModal(false);
              setPendingPack(null);
            }}
          />
        </Modal.Body>
      </Modal>
    </AppLayout>
  );
}
