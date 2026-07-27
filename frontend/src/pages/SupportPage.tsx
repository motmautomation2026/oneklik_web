import { useEffect, useState } from "react";
import { Alert, Badge, Card, Spinner } from "react-bootstrap";
import { Link } from "react-router-dom";
import SupportLayout from "../components/SupportLayout";
import { fetchMyTickets, TICKET_STATUS_LABEL, TICKET_STATUS_VARIANT, type TicketSummary } from "../lib/supportApi";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetchMyTickets(1, 50, controller.signal)
      .then((res) => {
        if (active) setTickets(res.rows);
      })
      .catch((err: unknown) => {
        if (active && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Could not load your requests.");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <SupportLayout>
      <div className="p-md-4 p-3">
        <div className="d-flex align-items-start justify-content-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="h4 mb-1">Support</h1>
            <p className="text-body-secondary mb-0 small">
              Raise a request and we'll reply here. You'll see our answer on this page.
            </p>
          </div>
          <Link to="/support/new" className="btn btn-primary">
            New request
          </Link>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        {!tickets && !error && (
          <div className="d-flex justify-content-center py-5">
            <Spinner animation="border" />
          </div>
        )}

        {tickets && tickets.length === 0 && (
          <Card className="border-0 shadow-sm">
            <Card.Body className="text-center py-5">
              <p className="mb-3 text-body-secondary">You haven't raised any requests yet.</p>
              <Link to="/support/new" className="btn btn-primary">
                Raise your first request
              </Link>
            </Card.Body>
          </Card>
        )}

        {tickets &&
          tickets.map((ticket) => (
            <Card key={ticket.id} className="border-0 shadow-sm mb-2">
              <Card.Body className="py-3">
                <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                  <div style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                      <Link to={`/support/${ticket.id}`} className="fw-semibold text-decoration-none">
                        {ticket.subject}
                      </Link>
                      {ticket.has_unread && (
                        <Badge bg="danger" title="We've replied since you last opened this">
                          New reply
                        </Badge>
                      )}
                    </div>
                    <div className="small text-body-secondary">
                      #{ticket.ticket_number} · Last activity {formatWhen(ticket.last_message_at)}
                    </div>
                  </div>
                  <Badge bg={TICKET_STATUS_VARIANT[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Badge>
                </div>
              </Card.Body>
            </Card>
          ))}
      </div>
    </SupportLayout>
  );
}
