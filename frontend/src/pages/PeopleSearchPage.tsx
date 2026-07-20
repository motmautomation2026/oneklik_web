import { useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  Modal,
  OverlayTrigger,
  Row,
  Spinner,
  Tooltip,
} from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import TagInput from "../components/TagInput";
import ClampedNumberInput from "../components/ClampedNumberInput";
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

function creditsForCount(count: number): number {
  return Math.max(1, Math.ceil(count / 25));
}

async function fetchProspeoSuggestions(type: "location" | "job_title", query: string): Promise<string[]> {
  const result = await apiPost<{ suggestions: string[] }>("/api/prospeo/suggestions", { query, type });
  return result.suggestions;
}

const fetchLocationSuggestions = (query: string) => fetchProspeoSuggestions("location", query);
const fetchJobTitleSuggestions = (query: string) => fetchProspeoSuggestions("job_title", query);

export default function PeopleSearchPage() {
  const { user } = useAuth();

  const [domains, setDomains] = useState<string[]>([]);
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [countPerCompany, setCountPerCompany] = useState(10);

  const [people, setPeople] = useState<Person[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealingEmailRows, setRevealingEmailRows] = useState<Set<number>>(new Set());
  const [revealingPhoneRows, setRevealingPhoneRows] = useState<Set<number>>(new Set());
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealNotice, setRevealNotice] = useState<string | null>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSearch = domains.length > 0;
  const maxTotal = Math.min(domains.length * countPerCompany, 200);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiPost<{ people: Person[] }>("/api/hv/people-search", {
        domains,
        job_titles: jobTitles,
        locations,
        count_per_company: countPerCompany,
      });
      setPeople(result.people);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function openSaveModal() {
    setListName(`People Search — ${new Date().toLocaleDateString()}`);
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
        .insert({ user_id: user.id, name: listName.trim() || "People Search", kind: "people" })
        .select("id")
        .single();
      if (listError || !list) throw new Error(listError?.message || "Could not create list");

      const rows = people.map((p) => ({
        list_id: list.id,
        user_id: user.id,
        data: p,
      }));
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

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === people.length ? new Set() : new Set(people.map((_, i) => i))));
  }

  async function reveal(indices: number[], field: "email" | "phone") {
    if (indices.length === 0) return;
    const setRevealing = field === "email" ? setRevealingEmailRows : setRevealingPhoneRows;
    const endpoint = field === "email" ? "/api/hv/email-reveal" : "/api/hv/phone-reveal";

    setRevealError(null);
    setRevealNotice(null);
    setRevealing((prev) => new Set([...prev, ...indices]));
    try {
      const selectedPeople = indices.map((i) => people[i]);
      const result = await apiPost<{ people: Person[]; skipped_count?: number }>(endpoint, {
        people: selectedPeople,
      });
      setPeople((prev) => {
        const next = [...prev];
        indices.forEach((idx, j) => {
          next[idx] = result.people[j];
        });
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        indices.forEach((i) => next.delete(i));
        return next;
      });
      if (result.skipped_count) {
        setRevealNotice(
          `${result.skipped_count} of ${indices.length} skipped — not enough credits to reveal them too.`,
        );
      }
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : `${field === "email" ? "Email" : "Phone"} reveal failed`);
    } finally {
      setRevealing((prev) => {
        const next = new Set(prev);
        indices.forEach((i) => next.delete(i));
        return next;
      });
    }
  }

  const findButton = (
    <Button type="submit" variant="primary" className="w-100" disabled={!canSearch || loading}>
      {loading ? (
        <>
          <Spinner animation="border" size="sm" className="me-2" />
          Searching…
        </>
      ) : (
        "Find People"
      )}
    </Button>
  );

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">People Search</h1>
        <Row className="g-4">
          <Col xs={12} lg={3}>
            <Card className="shadow-sm border-primary-subtle filter-panel">
              <Card.Body>
                <Form onSubmit={handleSearch}>
                  <TagInput
                    label="Company domains"
                    values={domains}
                    onChange={setDomains}
                    placeholder="e.g. zf.com, press Enter"
                  />

                  <TagInput
                    label="Job titles"
                    values={jobTitles}
                    onChange={setJobTitles}
                    placeholder="e.g. VP Sales, press Enter"
                    fetchSuggestions={fetchJobTitleSuggestions}
                  />

                  <TagInput
                    label="Location"
                    values={locations}
                    onChange={setLocations}
                    placeholder="Add a location, press Enter"
                    fetchSuggestions={fetchLocationSuggestions}
                  />

                  <ClampedNumberInput
                    label="Count per company"
                    value={countPerCompany}
                    onChange={setCountPerCompany}
                    min={1}
                    max={50}
                    helpText={
                      <>
                        Up to {maxTotal} people · Estimated cost: <strong>{creditsForCount(maxTotal)}</strong>{" "}
                        credit{creditsForCount(maxTotal) > 1 ? "s" : ""}
                      </>
                    }
                  />

                  {error && <Alert variant="danger">{error}</Alert>}

                  {canSearch ? (
                    findButton
                  ) : (
                    <OverlayTrigger overlay={<Tooltip>Add at least one company domain</Tooltip>}>
                      <span className="d-block">{findButton}</span>
                    </OverlayTrigger>
                  )}
                </Form>
              </Card.Body>
            </Card>
          </Col>

          <Col xs={12} lg={9}>
            <Card className="shadow-sm">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                  <h2 className="h6 mb-0 d-flex align-items-center gap-2">
                    People
                    {hasSearched && <Badge bg="primary">{people.length}</Badge>}
                  </h2>
                  <div className="d-flex align-items-center gap-2">
                    {selected.size > 0 && (
                      <>
                        <span className="small text-body-secondary">{selected.size} selected</span>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={revealingEmailRows.size > 0}
                          onClick={() => reveal(Array.from(selected).sort((a, b) => a - b), "email")}
                        >
                          {revealingEmailRows.size > 0 ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-1" />
                              Revealing…
                            </>
                          ) : (
                            `Reveal Email (${selected.size * 2} credits)`
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={revealingPhoneRows.size > 0}
                          onClick={() => reveal(Array.from(selected).sort((a, b) => a - b), "phone")}
                        >
                          {revealingPhoneRows.size > 0 ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-1" />
                              Revealing…
                            </>
                          ) : (
                            `Reveal Phone (${selected.size * 10} credits)`
                          )}
                        </Button>
                      </>
                    )}
                    {people.length > 0 && (
                      <Button size="sm" variant="outline-primary" onClick={openSaveModal}>
                        Save to list
                      </Button>
                    )}
                  </div>
                </div>

                {saved && (
                  <Alert variant="success" dismissible onClose={() => setSaved(false)}>
                    Saved to your list.
                  </Alert>
                )}

                {revealError && (
                  <Alert variant="danger" dismissible onClose={() => setRevealError(null)}>
                    {revealError}
                  </Alert>
                )}

                {revealNotice && (
                  <Alert variant="warning" dismissible onClose={() => setRevealNotice(null)}>
                    {revealNotice}
                  </Alert>
                )}

                {!hasSearched && !loading && (
                  <p className="text-body-secondary">
                    Add company domains and click Find People to get started.
                  </p>
                )}

                {loading && (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                  </div>
                )}

                {hasSearched && !loading && people.length === 0 && (
                  <p className="text-body-secondary">No people matched those filters.</p>
                )}

                {people.length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={people.length > 0 && selected.size === people.length}
                              onChange={toggleSelectAll}
                              aria-label="Select all"
                            />
                          </th>
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
                          <th>Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p, i) => (
                          <tr key={i}>
                            <td>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selected.has(i)}
                                onChange={() => toggleRow(i)}
                                aria-label={`Select ${p["FULL NAME"]}`}
                              />
                            </td>
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
                            <td className="small">
                              {p.Email ? (
                                <span>{p.Email}</span>
                              ) : revealingEmailRows.has(i) ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                <Button size="sm" variant="outline-primary" onClick={() => reveal([i], "email")}>
                                  Reveal
                                </Button>
                              )}
                            </td>
                            <td className="small">
                              {p.Phone ? (
                                <span>{p.Phone}</span>
                              ) : revealingPhoneRows.has(i) ? (
                                <Spinner animation="border" size="sm" />
                              ) : (
                                <Button size="sm" variant="outline-primary" onClick={() => reveal([i], "phone")}>
                                  Reveal
                                </Button>
                              )}
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
