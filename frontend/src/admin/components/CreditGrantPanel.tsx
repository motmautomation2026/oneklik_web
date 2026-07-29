import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { grantUserCredits } from "../api/adminApi";
import { formatNumber } from "../format";
import { ADMIN_CHART_COLORS } from "../theme";
import SectionCard from "./SectionCard";

/** Mirrors backend MAX_ADMIN_CREDIT_GRANT — keep in sync with queries.ts. */
const MAX_GRANT = 50_000;
const MIN_REASON_LENGTH = 5;

interface CreditGrantPanelProps {
  userId: string;
  availableBalance: number;
  // Called after a successful grant so the parent can refetch wallet KPIs + ledger.
  onChanged: () => void;
}

export default function CreditGrantPanel({ userId, availableBalance, onChanged }: CreditGrantPanelProps) {
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setAmountText("");
    setReason("");
    setError(null);
    setOpen(true);
  }

  function closeModal() {
    if (!submitting) setOpen(false);
  }

  const amount = amountText.trim() === "" ? NaN : Number(amountText);
  const amountValid = Number.isInteger(amount) && amount > 0 && amount <= MAX_GRANT;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH;
  const previewBalance = amountValid ? availableBalance + amount : null;
  const canSubmit = amountValid && reasonValid && !submitting;

  async function handleSubmit() {
    if (!amountValid) {
      setError(`Enter a whole number between 1 and ${formatNumber(MAX_GRANT)}.`);
      return;
    }
    if (!reasonValid) {
      setError(`A reason of at least ${MIN_REASON_LENGTH} characters is required.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await grantUserCredits(userId, { amount, reason: trimmedReason });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grant credits.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Credit compensation" loading={false} error={null}>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                Available: {formatNumber(availableBalance)}
              </span>
              <Button size="sm" variant="primary" onClick={openModal}>
                Grant credits…
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      <Modal show={open} onHide={closeModal} centered>
        <Modal.Header closeButton={!submitting}>
          <Modal.Title className="h6 mb-0">Grant credits</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            Adds credits to available balance only. Held credits and lifetime purchased are
            unchanged. Recorded in the credit ledger and an admin audit log.
          </p>

          <Form.Group className="mb-3">
            <Form.Label className="small mb-1">
              Amount <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="number"
              min={1}
              max={MAX_GRANT}
              step={1}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="e.g. 500"
              autoFocus
              disabled={submitting}
            />
            <Form.Text className="text-muted">
              Whole number, max {formatNumber(MAX_GRANT)} per grant.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label className="small mb-1">
              Reason <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Support ticket — missed renew credits"
              disabled={submitting}
            />
          </Form.Group>

          {previewBalance != null && (
            <div className="small mb-2" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
              {formatNumber(availableBalance)} → {formatNumber(previewBalance)} available
            </div>
          )}

          {error && <div className="small text-danger mt-2">{error}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" size="sm" onClick={closeModal} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Granting…" : "Confirm grant"}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
