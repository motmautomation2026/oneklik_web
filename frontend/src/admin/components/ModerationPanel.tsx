import { useState } from "react";
import { Badge, Button, Dropdown, Form, Modal } from "react-bootstrap";
import { setUserStatus } from "../api/adminApi";
import { ACCOUNT_STATUS_VARIANT } from "../badgeVariants";
import { formatDateTime } from "../format";
import { ADMIN_CHART_COLORS } from "../theme";
import type { AccountStatus, AdminUserRow, ModerationAction, ModerationActionRow } from "../types";
import DataTable from "./DataTable";
import PaginationBar from "./PaginationBar";
import SectionCard from "./SectionCard";

// Which account_status each action moves the user into — used to decide which
// buttons to show (an action is only offered if it would actually change the
// current status) and mirrors the backend's ACTION_TO_STATUS map.
const ACTION_TO_STATUS: Record<ModerationAction, AccountStatus> = {
  freeze: "frozen",
  suspend: "suspended",
  ban: "banned",
  reactivate: "active",
};

interface ActionMeta {
  label: string;
  variant: string;
  title: string;
  description: string;
}

const ACTION_META: Record<ModerationAction, ActionMeta> = {
  freeze: {
    label: "Freeze",
    variant: "info",
    title: "Freeze this account",
    description:
      "The user can still sign in and view their existing data, but can't spend credits — no searches, reveals, list merges, or purchases. Reversible at any time.",
  },
  suspend: {
    label: "Suspend",
    variant: "warning",
    title: "Suspend this account",
    description:
      "The user can sign in but is fully locked out of the product until reactivated (or until the optional date below passes). Reversible at any time.",
  },
  ban: {
    label: "Ban",
    variant: "danger",
    title: "Ban this account",
    description:
      "The user is permanently locked out at the authentication layer — they can no longer sign in or refresh their session. Reversible only by reactivating here.",
  },
  reactivate: {
    label: "Reactivate",
    variant: "success",
    title: "Reactivate this account",
    description: "Restores full access. Lifts any freeze, suspension, or ban currently on the account.",
  },
};

const historyColumns = [
  { key: "created_at", header: "When", render: (row: ModerationActionRow) => formatDateTime(row.created_at) },
  {
    key: "action",
    header: "Action",
    render: (row: ModerationActionRow) => (
      <Badge bg={ACCOUNT_STATUS_VARIANT[row.new_status] ?? "secondary"}>{ACTION_META[row.action]?.label ?? row.action}</Badge>
    ),
  },
  {
    key: "change",
    header: "Change",
    render: (row: ModerationActionRow) => (
      <span className="small">
        {row.previous_status} &rarr; {row.new_status}
      </span>
    ),
  },
  { key: "reason", header: "Reason", render: (row: ModerationActionRow) => row.reason ?? "—" },
  {
    key: "until",
    header: "Until",
    render: (row: ModerationActionRow) => (row.suspended_until ? formatDateTime(row.suspended_until) : "—"),
  },
  {
    key: "acted_by",
    header: "By",
    render: (row: ModerationActionRow) => row.acted_by_email ?? (row.acted_by ? row.acted_by : "System"),
  },
];

interface ModerationPanelProps {
  user: AdminUserRow;
  // Called after a successful status change so the parent can refetch the
  // user detail (status badge, reason, and history all update together).
  onChanged: () => void;
}

// Compact header control: an "Actions" dropdown (Freeze / Suspend / Ban /
// Reactivate, filtered to whichever would actually change the current
// status) plus the confirmation modal. Lives in the page header next to the
// status badge — the moderation history table is a separate export
// (ModerationHistoryCard) so it can be placed in the Account tab instead.
export default function ModerationPanel({ user, onChanged }: ModerationPanelProps) {
  const status = user.account_status;
  const [pendingAction, setPendingAction] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableActions = (Object.keys(ACTION_TO_STATUS) as ModerationAction[]).filter(
    (action) => ACTION_TO_STATUS[action] !== status,
  );

  function openModal(action: ModerationAction) {
    setPendingAction(action);
    setReason("");
    setUntil("");
    setError(null);
  }

  function closeModal() {
    if (!submitting) setPendingAction(null);
  }

  async function handleSubmit() {
    if (!pendingAction) return;
    const needsReason = pendingAction !== "reactivate";
    const trimmedReason = reason.trim();
    if (needsReason && !trimmedReason) {
      setError("A reason is required.");
      return;
    }

    let untilIso: string | undefined;
    if (pendingAction === "suspend" && until) {
      const parsed = new Date(until);
      if (Number.isNaN(parsed.getTime())) {
        setError("Enter a valid date and time.");
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        setError("The suspend-until date must be in the future.");
        return;
      }
      untilIso = parsed.toISOString();
    }

    setSubmitting(true);
    setError(null);
    try {
      await setUserStatus(user.user_id, {
        action: pendingAction,
        reason: trimmedReason || undefined,
        until: untilIso,
      });
      setPendingAction(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account status.");
    } finally {
      setSubmitting(false);
    }
  }

  const meta = pendingAction ? ACTION_META[pendingAction] : null;

  return (
    <>
      {availableActions.length > 0 && (
        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="outline-secondary" id="user-moderation-actions">
            Actions
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {availableActions.map((action) => (
              <Dropdown.Item key={action} onClick={() => openModal(action)}>
                {ACTION_META[action].label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
      )}

      <Modal show={pendingAction !== null} onHide={closeModal} centered>
        <Modal.Header closeButton={!submitting}>
          <Modal.Title className="h6 mb-0">{meta?.title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            {meta?.description}
          </p>

          <Form.Group className="mb-3">
            <Form.Label className="small mb-1">
              Reason {pendingAction === "reactivate" ? "(optional)" : <span className="text-danger">*</span>}
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded in the moderation audit log"
              autoFocus
              disabled={submitting}
            />
          </Form.Group>

          {pendingAction === "suspend" && (
            <Form.Group className="mb-2">
              <Form.Label className="small mb-1">Suspend until (optional)</Form.Label>
              <Form.Control
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                disabled={submitting}
              />
              <Form.Text className="text-muted">Leave empty to suspend indefinitely.</Form.Text>
            </Form.Group>
          )}

          {error && <div className="small text-danger mt-2">{error}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" size="sm" onClick={closeModal} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={meta?.variant ?? "primary"}
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Working…" : `Confirm ${meta?.label.toLowerCase()}`}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

interface ModerationHistoryCardProps {
  moderationActions: ModerationActionRow[];
  moderationTotal: number;
  moderationPage: number;
  moderationPageSize: number;
  moderationLoading: boolean;
  moderationError: string | null;
  onModerationPageChange: (page: number) => void;
}

// The read-only moderation audit log, split out from the Actions control so
// it can be placed in the Account tab while the trigger stays in the header.
export function ModerationHistoryCard({
  moderationActions,
  moderationTotal,
  moderationPage,
  moderationPageSize,
  moderationLoading,
  moderationError,
  onModerationPageChange,
}: ModerationHistoryCardProps) {
  return (
    <div className="row g-3 mb-4">
      <div className="col-12">
        <SectionCard
          title={`Moderation history (${moderationTotal})`}
          loading={moderationLoading}
          error={moderationError}
        >
          <DataTable
            columns={historyColumns}
            rows={moderationActions}
            getRowKey={(row) => row.id}
            emptyMessage="No moderation actions yet"
          />
          <PaginationBar
            page={moderationPage}
            pageSize={moderationPageSize}
            total={moderationTotal}
            onPageChange={onModerationPageChange}
          />
        </SectionCard>
      </div>
    </div>
  );
}
