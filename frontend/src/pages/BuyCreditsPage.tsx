import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Col, Container, Row, Spinner } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import { apiGet, apiPost } from "../lib/api";

interface CreditPack {
  id: string;
  credits: number;
  priceInr: number;
  comingSoon: boolean;
}

interface CheckoutResponse {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
}

interface PaymentStatus {
  id: string;
  status: "initiated" | "pending" | "success" | "failed";
  credits_promised: number;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

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
  const [result, setResult] = useState<{ credits: number } | null>(null);

  useEffect(() => {
    apiGet<{ packs: CreditPack[] }>("/api/payments/packs")
      .then((res) => setPacks(res.packs))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load credit packs"))
      .finally(() => setLoadingPacks(false));
  }, []);

  async function pollStatus(paymentId: string, creditsPromised: number) {
    setPolling(true);
    const maxAttempts = 30; // ~60s at 2s intervals
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const status = await apiGet<PaymentStatus>(`/api/payments/${paymentId}/status`);
        if (status.status === "success") {
          setResult({ credits: creditsPromised });
          setPolling(false);
          return;
        }
        if (status.status === "failed") {
          setError("Payment failed — no credits were added.");
          setPolling(false);
          return;
        }
      } catch {
        // keep polling — a transient network hiccup shouldn't abandon the check
      }
    }
    setPolling(false);
    setError("Still waiting on confirmation from the payment gateway — check Transaction History shortly.");
  }

  async function handleBuy(pack: CreditPack) {
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
        // The client-side handler is never trusted as proof of payment —
        // it just kicks off polling; the webhook is the only thing that
        // actually grants credits.
        handler: () => pollStatus(checkout.payment_id, pack.credits),
        modal: {
          ondismiss: () => setBuyingPackId(null),
        },
        theme: { color: "#563da4" },
      });
      razorpay.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
    } finally {
      setBuyingPackId(null);
    }
  }

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">Buy Credits</h1>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {result && (
          <Alert variant="success" dismissible onClose={() => setResult(null)}>
            Payment confirmed — {result.credits.toLocaleString()} credits added to your account.
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
            {packs.map((pack) => (
              <Col xs={12} md={4} key={pack.id}>
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
                        <h2 className="h5">{pack.credits.toLocaleString()} credits</h2>
                        <p className="text-body-secondary small flex-grow-1">
                          One-time purchase, added to your balance immediately after payment.
                        </p>
                        <div className="h3 mb-3">
                          ₹{pack.priceInr.toLocaleString()}
                        </div>
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
                          ) : (
                            "Buy Now"
                          )}
                        </Button>
                      </>
                    )}
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Container>
    </AppLayout>
  );
}
