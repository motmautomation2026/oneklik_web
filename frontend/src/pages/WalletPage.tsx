import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Container, ProgressBar, Row, Spinner, Table } from "react-bootstrap";
import { CreditCard } from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";

interface Wallet {
  available_balance: number;
  held_balance: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
}

// Only these four ever represent a *final*, real movement of credits.
// 'hold' and 'release' are the reserve/refund halves of a hold that either
// converts into a 'deduct' or unwinds to nothing — showing them would just
// duplicate the same credits as a phantom "used then refunded" pair.
type LedgerType = "deduct" | "purchase" | "promo_grant" | "admin_adjustment" | "expiry";

interface LedgerRow {
  id: number;
  type: LedgerType;
  amount: number;
  reference_id: string | null;
  reason_code: string | null;
  balance_after: number;
  created_at: string;
}

type Direction = "credit" | "debit";
type Filter = "all" | Direction;

const PAGE_SIZE = 20;

// enrichment_runs.run_type — the only thing that actually distinguishes
// *what* a deduct was for; reason_code alone doesn't (company_search and
// people_search share the same 'company_search_delivered' reason_code).
const RUN_TYPE_LABELS: Record<string, string> = {
  company_search: "Company search",
  people_search: "People search",
  email_enrich: "Email reveal",
  mobile_enrich: "Mobile reveal",
  email_template: "Email template",
};

function directionOf(row: LedgerRow): Direction {
  if (row.type === "deduct" || row.type === "expiry") return "debit";
  if (row.type === "admin_adjustment") return row.amount < 0 ? "debit" : "credit";
  return "credit";
}

function describe(row: LedgerRow, runTypeByRunId: Map<string, string>): string {
  if (row.type === "deduct") {
    const runType = row.reference_id ? runTypeByRunId.get(row.reference_id) : undefined;
    return runType && RUN_TYPE_LABELS[runType] ? RUN_TYPE_LABELS[runType] : "Credits used";
  }
  switch (row.type) {
    case "purchase":
      return "Monthly plan purchase";
    case "promo_grant":
      return "Free credits";
    case "admin_adjustment":
      return "Admin adjustment";
    case "expiry":
      return "Credits expired";
  }
}

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [runTypeByRunId, setRunTypeByRunId] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingWallet(true);
    supabase
      .from("credit_wallets")
      .select("available_balance, held_balance, lifetime_purchased, lifetime_consumed")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) setError(err.message);
        setWallet(data);
        setLoadingWallet(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingRows(true);

    // 'hold' and 'release' are excluded entirely — only a final deduct/expiry or an
    // actual grant (purchase/promo/admin) is a real transaction to show.
    const typesForFilter: LedgerType[] =
      filter === "credit"
        ? ["purchase", "promo_grant", "admin_adjustment"]
        : filter === "debit"
          ? ["deduct", "expiry", "admin_adjustment"]
          : ["deduct", "expiry", "purchase", "promo_grant", "admin_adjustment"];

    supabase
      .from("credit_ledger")
      .select("id, type, amount, reference_id, reason_code, balance_after, created_at")
      .eq("user_id", user.id)
      .in("type", typesForFilter)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
      .then(async ({ data, error: err }) => {
        if (!active) return;
        if (err) {
          setError(err.message);
          setLoadingRows(false);
          return;
        }
        const fetched = (data ?? []) as LedgerRow[];
        const filtered = fetched.filter((row) => filter === "all" || directionOf(row) === filter);
        const pageRows = filtered.slice(0, PAGE_SIZE);

        const runIds = [...new Set(pageRows.filter((r) => r.type === "deduct" && r.reference_id).map((r) => r.reference_id as string))];
        let map = new Map<string, string>();
        if (runIds.length > 0) {
          const { data: runs } = await supabase.from("enrichment_runs").select("id, run_type").in("id", runIds);
          map = new Map((runs ?? []).map((r) => [r.id as string, r.run_type as string]));
        }

        if (!active) return;
        setHasNextPage(fetched.length > PAGE_SIZE);
        setRows(pageRows);
        setRunTypeByRunId(map);
        setLoadingRows(false);
      });

    return () => {
      active = false;
    };
  }, [user, page, filter]);

  const totalEverGranted = wallet
    ? wallet.available_balance + wallet.held_balance + wallet.lifetime_consumed
    : 0;
  const consumedPct = totalEverGranted > 0 ? Math.round((wallet!.lifetime_consumed / totalEverGranted) * 100) : 0;

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <div className="d-flex align-items-center justify-content-between mb-4">
          <h1 className="h4 mb-0 text-primary">Wallet</h1>
          <Link to="/buy-credits" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2">
            <CreditCard size={16} />
            View plans
          </Link>
        </div>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loadingWallet ? (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        ) : (
          <>
            <Row className="g-3 mb-4">
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100">
                  <Card.Body>
                    <div className="text-body-secondary small">Available</div>
                    <div className="h4 mb-0">{wallet?.available_balance ?? 0}</div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100">
                  <Card.Body>
                    <div className="text-body-secondary small">Held (in progress)</div>
                    <div className="h4 mb-0">{wallet?.held_balance ?? 0}</div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100">
                  <Card.Body>
                    <div className="text-body-secondary small">Lifetime purchased</div>
                    <div className="h4 mb-0">{wallet?.lifetime_purchased ?? 0}</div>
                  </Card.Body>
                </Card>
              </Col>
              <Col xs={6} md={3}>
                <Card className="shadow-sm h-100">
                  <Card.Body>
                    <div className="text-body-secondary small">Lifetime consumed</div>
                    <div className="h4 mb-0">{wallet?.lifetime_consumed ?? 0}</div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Card className="shadow-sm mb-4">
              <Card.Body>
                <div className="d-flex justify-content-between small mb-1">
                  <span>Credits used</span>
                  <span>
                    {wallet?.lifetime_consumed ?? 0} of {totalEverGranted}
                  </span>
                </div>
                <ProgressBar now={consumedPct} label={`${consumedPct}%`} />
              </Card.Body>
            </Card>
          </>
        )}

        <Card className="shadow-sm">
          <Card.Body>
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0">Transaction history</h2>
              <ButtonGroup size="sm">
                <Button
                  variant={filter === "all" ? "primary" : "outline-primary"}
                  onClick={() => {
                    setFilter("all");
                    setPage(0);
                  }}
                >
                  All
                </Button>
                <Button
                  variant={filter === "credit" ? "primary" : "outline-primary"}
                  onClick={() => {
                    setFilter("credit");
                    setPage(0);
                  }}
                >
                  Credit
                </Button>
                <Button
                  variant={filter === "debit" ? "primary" : "outline-primary"}
                  onClick={() => {
                    setFilter("debit");
                    setPage(0);
                  }}
                >
                  Debit
                </Button>
              </ButtonGroup>
            </div>

            {loadingRows ? (
              <div className="text-center py-4">
                <Spinner animation="border" size="sm" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-body-secondary small mb-0">No transactions yet.</p>
            ) : (
              <div className="table-responsive">
                <Table hover size="sm" className="align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th className="text-end">Amount</th>
                      <th className="text-end">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const direction = directionOf(row);
                      const signedAmount = direction === "debit" ? -Math.abs(row.amount) : Math.abs(row.amount);
                      return (
                        <tr key={row.id}>
                          <td>{new Date(row.created_at).toLocaleString()}</td>
                          <td>
                            <Badge bg={direction === "credit" ? "success" : "danger"}>
                              {direction === "credit" ? "Credit" : "Debit"}
                            </Badge>
                          </td>
                          <td>{describe(row, runTypeByRunId)}</td>
                          <td className="text-end">
                            {signedAmount > 0 ? `+${signedAmount}` : signedAmount}
                          </td>
                          <td className="text-end">{row.balance_after}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}

            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={page === 0 || loadingRows}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={!hasNextPage || loadingRows}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </Card.Body>
        </Card>
      </Container>
    </AppLayout>
  );
}
