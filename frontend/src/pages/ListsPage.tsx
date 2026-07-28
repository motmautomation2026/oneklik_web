import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Card, Container, Form, Modal, Spinner } from "react-bootstrap";
import { ListUl } from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import PaginationBar from "../components/PaginationBar";
import { supabase } from "../lib/supabaseClient";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/AuthProvider";

interface ListRow {
  id: string;
  name: string;
  kind: "company" | "people";
  created_at: string;
  list_items: { count: number }[];
}

const PAGE_SIZE = 20;

export default function ListsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<ListRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [deleting, setDeleting] = useState<ListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Maps id -> kind (not just a Set<id>) so merge validation stays correct
  // even when the selection spans multiple pages and the other page's rows
  // aren't in `lists` right now.
  const [selected, setSelected] = useState<Map<string, ListRow["kind"]>>(new Map());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  async function loadLists() {
    if (!user) return;
    setLoading(true);
    setError(null);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count, error: fetchError } = await supabase
      .from("lists")
      .select("id, name, kind, created_at, list_items(count)", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setLists((data as ListRow[]) ?? []);
      setTotal(count ?? 0);
      // If a delete emptied the last page, step back rather than showing a blank page.
      if ((data?.length ?? 0) === 0 && page > 1) {
        setPage(page - 1);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, page]);

  function openRename(list: ListRow) {
    setRenaming(list);
    setRenameValue(list.name);
  }

  async function saveRename() {
    if (!renaming) return;
    setRenameSaving(true);
    const { error: renameErr } = await supabase
      .from("lists")
      .update({ name: renameValue.trim() || renaming.name })
      .eq("id", renaming.id);
    setRenameSaving(false);
    if (!renameErr) {
      setRenaming(null);
      loadLists();
    } else {
      setError(renameErr.message);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const { error: deleteErr } = await supabase.from("lists").delete().eq("id", deleting.id);
    setDeleteBusy(false);
    if (!deleteErr) {
      setDeleting(null);
      loadLists();
    } else {
      setError(deleteErr.message);
    }
  }

  function toggleSelected(list: ListRow) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(list.id)) next.delete(list.id);
      else next.set(list.id, list.kind);
      return next;
    });
  }

  const selectedKinds = new Set(selected.values());
  const canMerge = selected.size >= 2 && selectedKinds.size === 1;

  function openMergeModal() {
    setMergeName(`Merged List — ${new Date().toLocaleDateString()}`);
    setMergeError(null);
    setShowMergeModal(true);
  }

  async function handleMerge() {
    setMerging(true);
    setMergeError(null);
    try {
      const result = await apiPost<{ list_id: string }>("/api/lists/merge", {
        list_ids: Array.from(selected.keys()),
        name: mergeName.trim(),
      });
      setShowMergeModal(false);
      setSelected(new Map());
      navigate(`/lists/${result.list_id}`);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Could not merge lists");
    } finally {
      setMerging(false);
    }
  }

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
          <h1 className="h4 mb-0 text-primary">Lists</h1>
          {selected.size > 0 && (
            <div className="d-flex align-items-center gap-2">
              <span className="small text-body-secondary">{selected.size} selected</span>
              {selectedKinds.size > 1 && (
                <span className="small text-warning">Can only merge lists of the same type</span>
              )}
              <Button size="sm" variant="primary" disabled={!canMerge} onClick={openMergeModal}>
                Merge
              </Button>
            </div>
          )}
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        <Card className="shadow-sm">
          <Card.Body>
            {loading && (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
              </div>
            )}

            {!loading && lists.length === 0 && (
              <div className="text-center text-body-secondary py-5">
                <ListUl size={28} className="mb-2 opacity-50" />
                <p className="mb-0">
                  No lists yet — saving results from Company Search, People Search, or a Reveal action creates one.
                </p>
              </div>
            )}

            {!loading && lists.length > 0 && (
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Rows</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lists.map((list) => (
                      <tr key={list.id}>
                        <td>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={selected.has(list.id)}
                            onChange={() => toggleSelected(list)}
                            aria-label={`Select ${list.name}`}
                          />
                        </td>
                        <td className="fw-semibold">
                          <Link to={`/lists/${list.id}`}>{list.name}</Link>
                        </td>
                        <td>
                          <Badge bg={list.kind === "company" ? "primary" : "secondary"}>{list.kind}</Badge>
                        </td>
                        <td>{list.list_items?.[0]?.count ?? 0}</td>
                        <td className="text-body-secondary small">
                          {new Date(list.created_at).toLocaleDateString()}
                        </td>
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary" className="me-2" onClick={() => openRename(list)}>
                            Rename
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => setDeleting(list)}>
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && lists.length > 0 && (
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            )}
          </Card.Body>
        </Card>
      </Container>

      <Modal show={renaming !== null} onHide={() => setRenaming(null)}>
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
          <Button variant="outline-secondary" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={saveRename} disabled={renameSaving}>
            {renameSaving ? "Saving…" : "Save"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={deleting !== null} onHide={() => setDeleting(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Delete list</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Delete <strong>{deleting?.name}</strong> and all {deleting?.list_items?.[0]?.count ?? 0} of its rows? This
          can't be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showMergeModal} onHide={() => setShowMergeModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Merge {selected.size} lists</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {mergeError && <Alert variant="danger">{mergeError}</Alert>}
          <p className="small text-body-secondary">
            Creates a new list containing every row from the selected lists, with duplicates removed. The original
            lists are left untouched.
          </p>
          <Form.Group>
            <Form.Label>New list name</Form.Label>
            <Form.Control value={mergeName} onChange={(e) => setMergeName(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowMergeModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleMerge} disabled={merging}>
            {merging ? "Merging…" : "Merge"}
          </Button>
        </Modal.Footer>
      </Modal>
    </AppLayout>
  );
}
