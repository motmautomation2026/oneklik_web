import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Container, Row, Spinner, Table } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";

type PaymentStatus = "initiated" | "pending" | "success" | "failed";

interface PaymentRow {
  id: string;
  gateway: "razorpay" | "stripe";
  gateway_payment_id: string | null;
  status: PaymentStatus;
  credits_promised: number;
  amount_minor_units: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

type Filter = "all" | PaymentStatus;

const PAGE_SIZE = 20;

// Same mapping as the admin console (AdminTransactionsPage) so a given
// status always reads as the same color everywhere in the product.
const STATUS_VARIANT: Record<PaymentStatus, string> = {
  success: "success",
  pending: "warning",
  initiated: "secondary",
  failed: "danger",
};

// "initiated" means checkout was started but never reached the gateway (or
// the order call itself failed) — nothing a user would recognize as "a
// payment", so it's labelled distinctly from a genuine gateway failure.
const STATUS_LABEL: Record<PaymentStatus, string> = {
  success: "Success",
  pending: "Pending",
  initiated: "Incomplete",
  failed: "Failed",
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatAmount(minorUnits: number, currency: string): string {
  if (currency !== "INR") return `${(minorUnits / 100).toLocaleString()} ${currency}`;
  return inrFormatter.format(minorUnits / 100);
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lifetime totals across *all* of the user's payments, independent of the
  // current page/filter — a second, unfiltered query keeps this stable
  // while the table below is paged and filtered.
  const [summary, setSummary] = useState<{ totalSpentMinorUnits: number; creditsPurchased: number; successCount: number } | null>(
    null,
  );

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("payments")
      .select("amount_minor_units, credits_promised")
      .eq("user_id", user.id)
      .eq("status", "success")
      .then(({ data }) => {
        if (!active || !data) return;
        setSummary({
          totalSpentMinorUnits: data.reduce((sum, r) => sum + (r.amount_minor_units ?? 0), 0),
          creditsPurchased: data.reduce((sum, r) => sum + (r.credits_promised ?? 0), 0),
          successCount: data.length,
        });
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);

    let query = supabase
      .from("payments")
      .select("id, gateway, gateway_payment_id, status, credits_promised, amount_minor_units, currency, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    query.then(({ data, error: err }) => {
      if (!active) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const fetched = (data ?? []) as PaymentRow[];
      setHasNextPage(fetched.length > PAGE_SIZE);
      setRows(fetched.slice(0, PAGE_SIZE));
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user, page, filter]);

  const lastPaymentAt = useMemo(() => {
    const success = rows.find((r) => r.status === "success");
    return success?.created_at ?? null;
  }, [rows]);

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <div className="d-flex align-items-center justify-content-between mb-4">
          <div>
            <h1 className="h4 mb-0 text-primary">Payments</h1>
            <p className="text-body-secondary small mb-0">A record of every credit purchase you've made.</p>
          </div>
          <Link to="/buy-credits" className="btn btn-primary btn-sm">
            Buy Credits
          </Link>
        </div>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Row className="g-3 mb-4">
          <Col xs={6} md={3}>
            <Card className="shadow-sm h-100">
              <Card.Body>
                <div className="text-body-secondary small">Total spent</div>
                <div className="h4 mb-0">
                  {summary ? inrFormatter.format(summary.totalSpentMinorUnits / 100) : <Spinner animation="border" size="sm" />}
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={6} md={3}>
            <Card className="shadow-sm h-100">
              <Card.Body>
                <div className="text-body-secondary small">Credits purchased</div>
                <div className="h4 mb-0">{summary ? summary.creditsPurchased.toLocaleString() : <Spinner animation="border" size="sm" />}</div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={6} md={3}>
            <Card className="shadow-sm h-100">
              <Card.Body>
                <div className="text-body-secondary small">Successful payments</div>
                <div className="h4 mb-0">{summary ? summary.successCount : <Spinner animation="border" size="sm" />}</div>
              </Card.Body>
            </Card>
          </Col>
          <Col xs={6} md={3}>
            <Card className="shadow-sm h-100">
              <Card.Body>
                <div className="text-body-secondary small">Last payment</div>
                <div className="h5 mb-0">{lastPaymentAt ? new Date(lastPaymentAt).toLocaleDateString() : "—"}</div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Card className="shadow-sm">
          <Card.Body>
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0">Payment history</h2>
              <ButtonGroup size="sm">
                {FILTERS.map((f) => (
                  <Button
                    key={f.value}
                    variant={filter === f.value ? "primary" : "outline-primary"}
                    onClick={() => {
                      setFilter(f.value);
                      setPage(0);
                    }}
                  >
                    {f.label}
                  </Button>
                ))}
              </ButtonGroup>
            </div>

            {loading ? (
              <div className="text-center py-4">
                <Spinner animation="border" size="sm" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-body-secondary small mb-0">
                {filter === "all" ? "No payments yet." : `No ${STATUS_LABEL[filter as PaymentStatus].toLowerCase()} payments.`}
              </p>
            ) : (
              <div className="table-responsive">
                <Table hover size="sm" className="align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Payment ID</th>
                      <th>Gateway</th>
                      <th className="text-end">Amount</th>
                      <th className="text-end">Credits</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.created_at).toLocaleString()}</td>
                        <td className="text-body-secondary small font-monospace">{row.gateway_payment_id ?? "—"}</td>
                        <td className="text-capitalize">{row.gateway}</td>
                        <td className="text-end">{formatAmount(row.amount_minor_units, row.currency)}</td>
                        <td className="text-end">{row.credits_promised.toLocaleString()}</td>
                        <td>
                          <Badge bg={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button variant="outline-secondary" size="sm" disabled={!hasNextPage || loading} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </Card.Body>
        </Card>
      </Container>
    </AppLayout>
  );
}
