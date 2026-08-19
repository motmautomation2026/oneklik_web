import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Button, Card, Container, Form, Modal, Spinner } from "react-bootstrap";
import { ArrowLeft } from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import { supabase } from "../lib/supabaseClient";
import { apiPost } from "../lib/api";
import { downloadCsv } from "../lib/csv";

interface ListMeta {
  id: string;
  name: string;
  kind: "company" | "people";
}

interface ListItemRow {
  id: string;
  data: Record<string, string>;
  enrichment_status: "pending" | "enriched" | "not_found" | "error";
}

const STATUS_VARIANT: Record<string, string> = {
  pending: "secondary",
  enriched: "success",
  not_found: "warning",
  error: "danger",
};

const COMPANY_COLUMNS = ["Company", "Website", "Location", "Industry", "Headcount", "Phone", "LinkedIn"];
const PEOPLE_COLUMNS = [
  "FULL NAME",
  "JOB POSITION",
  "COMPANY NAME",
  "LOCATION",
  "INDUSTRY",
  "USER SOCIAL",
  "Email",
  "Phone",
];

interface RevealResult {
  updated_count: number;
  already_done_count: number;
  skipped_count: number;
}

// Mirrors REVEAL_BATCH_SIZE / MAX_ROWS_PER_REQUEST in PeopleSearchPage.tsx
// and revealFlow.ts — the backend now rejects any single request over this
// count outright (rather than silently truncating it), so re-running enrich
// on a large saved-list selection has to chunk client-side the same way.
const REVEAL_BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [list, setList] = useState<ListMeta | null>(null);
  const [items, setItems] = useState<ListItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revealingEmail, setRevealingEmail] = useState(false);
  const [revealingPhone, setRevealingPhone] = useState(false);
  const [revealNotice, setRevealNotice] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealProgress, setRevealProgress] = useState<{ done: number; total: number } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [{ data: listData, error: listErr }, { data: itemsData, error: itemsErr }] = await Promise.all([
      supabase.from("lists").select("id, name, kind").eq("id", id).single(),
      supabase
        .from("list_items")
        .select("id, data, enrichment_status")
        .eq("list_id", id)
        .order("created_at", { ascending: true }),
    ]);

    if (listErr || itemsErr) {
      setError(listErr?.message || itemsErr?.message || "Could not load this list");
    } else {
      setList(listData as ListMeta);
      setItems((itemsData as ListItemRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openRename() {
    if (!list) return;
    setRenameValue(list.name);
    setShowRename(true);
  }

  async function saveRename() {
    if (!list) return;
    setRenameSaving(true);
    const { error: renameErr } = await supabase
      .from("lists")
      .update({ name: renameValue.trim() || list.name })
      .eq("id", list.id);
    setRenameSaving(false);
    if (!renameErr) {
      setShowRename(false);
      load();
    } else {
      setError(renameErr.message);
    }
  }

  async function confirmDelete() {
    if (!list) return;
    setDeleteBusy(true);
    const { error: deleteErr } = await supabase.from("lists").delete().eq("id", list.id);
    setDeleteBusy(false);
    if (!deleteErr) {
      navigate("/lists");
    } else {
      setError(deleteErr.message);
      setShowDelete(false);
    }
  }

  function handleExport() {
    if (!list) return;
    downloadCsv(`${list.name}.csv`, items.map((i) => i.data));
  }

  function toggleSelected(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  function describeResult(field: "email" | "phone", result: RevealResult): string {
    const parts = [`${result.updated_count} revealed`];
    if (result.already_done_count > 0) parts.push(`${result.already_done_count} already had ${field}`);
    if (result.skipped_count > 0) parts.push(`${result.skipped_count} skipped — not enough credits`);
    return parts.join(" · ");
  }

  async function reRunEnrich(field: "email" | "phone") {
    if (selected.size === 0 || (field === "email" ? revealingEmail : revealingPhone)) return;
    const setBusy = field === "email" ? setRevealingEmail : setRevealingPhone;
    const endpoint = field === "email" ? "/api/hv/list-email-reveal" : "/api/hv/list-phone-reveal";

    setBusy(true);
    setRevealError(null);
    setRevealNotice(null);

    const ids = Array.from(selected);
    const batches = chunk(ids, REVEAL_BATCH_SIZE);
    setRevealProgress(batches.length > 1 ? { done: 0, total: ids.length } : null);

    const totals: RevealResult = { updated_count: 0, already_done_count: 0, skipped_count: 0 };
    let processed = 0;

    try {
      for (const batch of batches) {
        if (!mountedRef.current) return;
        const result = await apiPost<RevealResult>(endpoint, { list_item_ids: batch });
        if (!mountedRef.current) return;
        totals.updated_count += result.updated_count;
        totals.already_done_count += result.already_done_count;
        totals.skipped_count += result.skipped_count;
        processed += batch.length;
        if (batches.length > 1) setRevealProgress({ done: processed, total: ids.length });
      }
      setRevealNotice(describeResult(field, totals));
      setSelected(new Set());
      await load();
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : `${field === "email" ? "Email" : "Phone"} reveal failed`;
        setRevealError(
          processed > 0 ? `${message} (${processed} of ${ids.length} already processed before this failed.)` : message,
        );
      }
      // Already-completed batches wrote real rows even though the sequence
      // as a whole failed — refresh so the list reflects what actually went through.
      if (processed > 0) await load();
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setRevealProgress(null);
      }
    }
  }

  const columns = list?.kind === "people" ? PEOPLE_COLUMNS : COMPANY_COLUMNS;
  const isPeopleList = list?.kind === "people";

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <Link to="/lists" className="ticket-back-link mb-2">
          <ArrowLeft size={14} />
          All lists
        </Link>

        {error && <Alert variant="danger">{error}</Alert>}

        {loading && (
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
          </div>
        )}

        {!loading && list && (
          <>
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
              <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2">
                {list.name}
                <Badge bg={list.kind === "company" ? "primary" : "secondary"}>{list.kind}</Badge>
              </h1>
              <div className="d-flex gap-2 flex-wrap align-items-center">
                {isPeopleList && selected.size > 0 && (
                  <>
                    <span className="small text-body-secondary">{selected.size} selected</span>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={revealingEmail}
                      onClick={() => reRunEnrich("email")}
                    >
                      {revealingEmail ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-1" />
                          {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
                        </>
                      ) : (
                        "Reveal Email (2 cr each)"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={revealingPhone}
                      onClick={() => reRunEnrich("phone")}
                    >
                      {revealingPhone ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-1" />
                          {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
                        </>
                      ) : (
                        "Reveal Phone (20 cr each)"
                      )}
                    </Button>
                  </>
                )}
                <Button size="sm" variant="outline-primary" onClick={openRename}>
                  Rename
                </Button>
                <Button size="sm" variant="outline-primary" onClick={handleExport} disabled={items.length === 0}>
                  Export CSV
                </Button>
                <Button size="sm" variant="outline-danger" onClick={() => setShowDelete(true)}>
                  Delete
                </Button>
              </div>
            </div>

            {revealNotice && (
              <Alert variant="success" dismissible onClose={() => setRevealNotice(null)}>
                {revealNotice}
              </Alert>
            )}
            {revealError && (
              <Alert variant="danger" dismissible onClose={() => setRevealError(null)}>
                {revealError}
              </Alert>
            )}

            <Card className="shadow-sm">
              <Card.Body>
                {items.length === 0 ? (
                  <p className="text-body-secondary mb-0">This list has no rows.</p>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          {isPeopleList && (
                            <th>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={items.length > 0 && selected.size === items.length}
                                onChange={toggleSelectAll}
                                aria-label="Select all"
                              />
                            </th>
                          )}
                          <th>Status</th>
                          {columns.map((col) => (
                            <th key={col}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id}>
                            {isPeopleList && (
                              <td>
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={selected.has(item.id)}
                                  onChange={() => toggleSelected(item.id)}
                                  aria-label={`Select row ${item.id}`}
                                />
                              </td>
                            )}
                            <td>
                              <Badge bg={STATUS_VARIANT[item.enrichment_status] ?? "secondary"}>
                                {item.enrichment_status}
                              </Badge>
                            </td>
                            {columns.map((col) => (
                              <td key={col} className="text-truncate" style={{ maxWidth: 200 }}>
                                {item.data[col] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card.Body>
            </Card>
          </>
        )}
      </Container>

      <Modal show={showRename} onHide={() => setShowRename(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Rename list</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>List name</Form.Label>
            <Form.Control value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowRename(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveRename} disabled={renameSaving}>
            {renameSaving ? "Saving…" : "Save"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showDelete} onHide={() => setShowDelete(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete list</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Delete <strong>{list?.name}</strong> and all {items.length} of its rows? This can't be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </Modal.Footer>
      </Modal>
    </AppLayout>
  );
}
