import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Container, Form, Modal, Row, Spinner } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import TagInput from "../components/TagInput";
import { apiPost } from "../lib/api";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";

interface Person {
  "FULL NAME": string;
  "USER SOCIAL": string;
  "JOB POSITION": string;
  COUNTRY: string;
  LOCATION: string;
  INDUSTRY: string;
  "COMPANY NAME": string;
  "COMPANY URL": string;
  "COMPANY SOCIAL LINK": string;
  "COMPANY SIZE": string;
  "COMPANY COUNTRY": string;
  "COMPANY LOCATION": string;
  "COMPANY STATE": string;
  "COMPANY CITY": string;
  Email: string;
  Phone: string;
}

export default function LinkedInLookupPage() {
  const { user } = useAuth();

  const [urls, setUrls] = useState<string[]>([]);

  const [people, setPeople] = useState<Person[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSearch = urls.length > 0;

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSaved(false);
    try {
      const result = await apiPost<{
        people: Person[];
        email_skipped_count?: number;
        phone_skipped_count?: number;
      }>("/api/hv/linkedin-lookup", {
        linkedin_urls: urls,
      });
      setPeople(result.people);
      setHasSearched(true);

      const notes: string[] = [];
      if (result.email_skipped_count) {
        notes.push(`email skipped for ${result.email_skipped_count} (not enough credits)`);
      }
      if (result.phone_skipped_count) {
        notes.push(`phone skipped for ${result.phone_skipped_count} (not enough credits)`);
      }
      if (notes.length > 0) {
        setNotice(notes.join(" · "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "LinkedIn lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function openSaveModal() {
    setListName(`LinkedIn Lookup — ${new Date().toLocaleDateString()}`);
    setSaveError(null);
    setShowSaveModal(true);
  }

  async function handleSaveList() {
    if (!user || people.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data: list, error: listError } = await supabase
        .from("lists")
        .insert({ user_id: user.id, name: listName.trim() || "LinkedIn Lookup", kind: "people" })
        .select("id")
        .single();
      if (listError || !list) throw new Error(listError?.message || "Could not create list");

      const rows = people.map((p) => ({ list_id: list.id, user_id: user.id, data: p }));
      const { error: itemsError } = await supabase.from("list_items").insert(rows);
      if (itemsError) throw new Error(itemsError.message);

      setShowSaveModal(false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save list");
    } finally {
      setSaving(false);
    }
  }

  const findButton = (
    <Button type="submit" variant="primary" className="w-100" disabled={!canSearch || loading}>
      {loading ? (
        <>
          <Spinner animation="border" size="sm" className="me-2" />
          Looking up…
        </>
      ) : (
        "Search"
      )}
    </Button>
  );

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">LinkedIn Lookup</h1>
        <Row className="g-4">
          <Col xs={12} lg={3}>
            <Card className="shadow-sm border-primary-subtle filter-panel">
              <Card.Body>
                <Form onSubmit={handleSearch}>
                  <TagInput
                    label="LinkedIn URLs"
                    values={urls}
                    onChange={setUrls}
                    placeholder="Paste a profile URL, press Enter"
                  />

                  <div className="cost-note">
                    <p>Every lookup checks email and phone automatically. The lookup itself is free:</p>
                    <ul>
                      <li>
                        <span>Email found</span>
                        <strong>2 credits</strong>
                      </li>
                      <li>
                        <span>Phone found</span>
                        <strong>20 credits</strong>
                      </li>
                      <li>
                        <span>Both found</span>
                        <strong>22 credits</strong>
                      </li>
                      <li>
                        <span>Nothing found</span>
                        <strong>Free</strong>
                      </li>
                    </ul>
                  </div>

                  {error && <Alert variant="danger">{error}</Alert>}

                  {findButton}
                </Form>
              </Card.Body>
            </Card>
          </Col>

          <Col xs={12} lg={9}>
            <Card className="shadow-sm">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                  <h2 className="h6 mb-0 d-flex align-items-center gap-2">
                    Profiles
                    {hasSearched && <Badge bg="primary">{people.length}</Badge>}
                  </h2>
                  {people.length > 0 && (
                    <Button size="sm" variant="outline-primary" onClick={openSaveModal}>
                      Save to list
                    </Button>
                  )}
                </div>

                {saved && (
                  <Alert variant="success" dismissible onClose={() => setSaved(false)}>
                    Saved to your list.
                  </Alert>
                )}

                {notice && (
                  <Alert variant="warning" dismissible onClose={() => setNotice(null)}>
                    {notice}
                  </Alert>
                )}

                {!hasSearched && !loading && (
                  <p className="text-body-secondary">Paste one or more LinkedIn URLs and click Search.</p>
                )}

                {loading && (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                  </div>
                )}

                {hasSearched && !loading && people.length === 0 && (
                  <p className="text-body-secondary">No profiles found for those URLs.</p>
                )}

                {people.length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Job Title</th>
                          <th>LinkedIn</th>
                          <th>Country</th>
                          <th>Location</th>
                          <th>Industry</th>
                          <th>Company</th>
                          <th>Company URL</th>
                          <th>Company LinkedIn</th>
                          <th>Company Size</th>
                          <th>Company Country</th>
                          <th>Company Location</th>
                          <th>Company State</th>
                          <th>Company City</th>
                          <th>Email</th>
                          <th style={{ minWidth: 150 }}>Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p, i) => (
                          <tr key={i}>
                            <td className="fw-semibold">{p["FULL NAME"]}</td>
                            <td className="text-truncate" style={{ maxWidth: 180 }}>
                              {p["JOB POSITION"]}
                            </td>
                            <td>
                              {p["USER SOCIAL"] && (
                                <a href={p["USER SOCIAL"]} target="_blank" rel="noreferrer">
                                  View
                                </a>
                              )}
                            </td>
                            <td>{p.COUNTRY}</td>
                            <td className="text-truncate" style={{ maxWidth: 180 }}>
                              {p.LOCATION}
                            </td>
                            <td>{p.INDUSTRY}</td>
                            <td>{p["COMPANY NAME"]}</td>
                            <td>
                              {p["COMPANY URL"] && (
                                <a href={p["COMPANY URL"]} target="_blank" rel="noreferrer">
                                  {p["COMPANY URL"].replace(/^https?:\/\//, "")}
                                </a>
                              )}
                            </td>
                            <td>
                              {p["COMPANY SOCIAL LINK"] && (
                                <a href={p["COMPANY SOCIAL LINK"]} target="_blank" rel="noreferrer">
                                  View
                                </a>
                              )}
                            </td>
                            <td>{p["COMPANY SIZE"]}</td>
                            <td>{p["COMPANY COUNTRY"]}</td>
                            <td className="text-truncate" style={{ maxWidth: 180 }}>
                              {p["COMPANY LOCATION"]}
                            </td>
                            <td>{p["COMPANY STATE"]}</td>
                            <td>{p["COMPANY CITY"]}</td>
                            <td className="small">{p.Email || "Not found"}</td>
                            <td className="small text-nowrap" style={{ minWidth: 150 }}>
                              {p.Phone || "Not found"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      <Modal show={showSaveModal} onHide={() => setShowSaveModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Save to list</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {saveError && <Alert variant="danger">{saveError}</Alert>}
          <Form.Group>
            <Form.Label>List name</Form.Label>
            <Form.Control value={listName} onChange={(e) => setListName(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowSaveModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveList} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </Modal.Footer>
      </Modal>
    </AppLayout>
  );
}
