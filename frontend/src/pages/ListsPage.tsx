import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Container, Form, Modal, Spinner } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";

interface ListRow {
  id: string;
  name: string;
  kind: "company" | "people";
  created_at: string;
  list_items: { count: number }[];
}

export default function ListsPage() {
  const { user } = useAuth();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<ListRow | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const [deleting, setDeleting] = useState<ListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function loadLists() {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("lists")
      .select("id, name, kind, created_at, list_items(count)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setLists((data as ListRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">Lists</h1>

        {error && <Alert variant="danger">{error}</Alert>}

        <Card className="shadow-sm">
          <Card.Body>
            {loading && (
              <div className="text-center py-5">
                <Spinner animation="border" variant="primary" />
              </div>
            )}

            {!loading && lists.length === 0 && (
              <p className="text-body-secondary mb-0">
                No lists yet — saving results from Company Search, People Search, or a Reveal action creates one.
              </p>
            )}

            {!loading && lists.length > 0 && (
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead>
                    <tr>
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
    </AppLayout>
  );
}
