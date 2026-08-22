import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Col, Container, Form, Modal, Nav, Row, Spinner, Toast, ToastContainer } from "react-bootstrap";
import { Linkedin } from "react-bootstrap-icons";
import { useSearchParams } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import ChromeExtensionPanel from "../components/ChromeExtensionPanel";
import TagInput from "../components/TagInput";
import { apiPost } from "../lib/api";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import { useSessionStorageState } from "../lib/useSessionStorageState";

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

// Mirrors the backend's MAX_ROWS_PER_REQUEST (revealFlow.ts) — kept as a
// named constant so the reveal batch size this page uses can't drift out of
// sync with what the server actually allows.
const REVEAL_BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

type LookupTab = "lookup" | "extension";

export default function LinkedInLookupPage() {
  const { user } = useAuth();

  // Kept in the URL rather than component state so support can link someone
  // straight to the install guide with /linkedin-lookup?tab=extension.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: LookupTab = searchParams.get("tab") === "extension" ? "extension" : "lookup";

  function selectTab(next: LookupTab) {
    const params = new URLSearchParams(searchParams);
    if (next === "extension") params.set("tab", "extension");
    else params.delete("tab");
    setSearchParams(params, { replace: true });
  }

  const [urls, setUrls] = useSessionStorageState<string[]>("linkedinLookup.urls", []);

  const [people, setPeople] = useSessionStorageState<Person[]>("linkedinLookup.people", []);
  const [hasSearched, setHasSearched] = useSessionStorageState("linkedinLookup.hasSearched", false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealingEmailRows, setRevealingEmailRows] = useState<Set<number>>(new Set());
  const [revealingPhoneRows, setRevealingPhoneRows] = useState<Set<number>>(new Set());
  const [notFoundEmailRows, setNotFoundEmailRows] = useState<Set<number>>(new Set());
  const [notFoundPhoneRows, setNotFoundPhoneRows] = useState<Set<number>>(new Set());
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealNotice, setRevealNotice] = useState<string | null>(null);
  const [revealProgress, setRevealProgress] = useState<{ done: number; total: number } | null>(null);
  const revealBusy = revealingEmailRows.size > 0 || revealingPhoneRows.size > 0;

  // Guards against setState-after-unmount if a user navigates away mid-batch
  // — the batch loop checks this before touching state on every iteration.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSearch = urls.length > 0;

  function handleClearFilters() {
    setUrls([]);
    setError(null);
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    // A reveal batch sequence writes into `people` by array index as each
    // batch resolves — running a fresh search (which replaces `people`
    // wholesale) while that's in flight would let a late-arriving batch
    // write stale results into the new, unrelated result set.
    if (!canSearch || revealBusy) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setSelected(new Set());
    try {
      const result = await apiPost<{ people: Person[] }>("/api/hv/linkedin-lookup", {
        linkedin_urls: urls,
      });
      setPeople(result.people);
      setHasSearched(true);
      setNotFoundEmailRows(new Set());
      setNotFoundPhoneRows(new Set());
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

  // Sends the selection in sequential batches of REVEAL_BATCH_SIZE rather
  // than one request for the whole selection — see PeopleSearchPage's reveal()
  // for why this is structural, not just a size guard: a response shorter
  // than the request must never be indexed against the longer selection.
  // Batches run one at a time so a large reveal doesn't throw a burst of
  // simultaneous large requests at the enrichment provider.
  async function reveal(requestedIndices: number[], field: "email" | "phone") {
    const personField = field === "email" ? "Email" : "Phone";
    // A bulk selection (e.g. select-all) can include rows that already show
    // a revealed value — silently re-billing and re-fetching those would
    // charge credits for data the user already has. Per-row Reveal buttons
    // can't hit this (they disappear once revealed), but the bulk button can.
    const indices = requestedIndices.filter((i) => !people[i]?.[personField]);
    if (indices.length === 0) return;

    const revealingSet = field === "email" ? revealingEmailRows : revealingPhoneRows;
    if (indices.some((i) => revealingSet.has(i))) return;
    const setRevealing = field === "email" ? setRevealingEmailRows : setRevealingPhoneRows;
    const setNotFound = field === "email" ? setNotFoundEmailRows : setNotFoundPhoneRows;
    const endpoint = field === "email" ? "/api/hv/linkedin-email-reveal" : "/api/hv/linkedin-phone-reveal";

    setRevealError(null);
    setRevealNotice(null);
    setRevealing((prev) => new Set([...prev, ...indices]));

    const batches = chunk(indices, REVEAL_BATCH_SIZE);
    setRevealProgress(batches.length > 1 ? { done: 0, total: indices.length } : null);

    let totalSkipped = 0;
    let processed = 0;

    try {
      for (const batch of batches) {
        if (!mountedRef.current) return;

        const selectedPeople = batch.map((i) => people[i]);
        const result = await apiPost<{ people: Person[]; skipped_count?: number }>(endpoint, {
          people: selectedPeople,
        });

        if (!mountedRef.current) return;

        // Bounded by result.people.length no matter what the server sends
        // back — a short/empty response for a row just leaves that row
        // untouched instead of ever writing `undefined`/`null` into state.
        setPeople((prev) => {
          const next = [...prev];
          batch.forEach((idx, j) => {
            if (j < result.people.length) next[idx] = result.people[j];
          });
          return next;
        });
        setNotFound((prev) => {
          const next = new Set(prev);
          batch.forEach((idx, j) => {
            if (j < result.people.length && !result.people[j]?.[personField]) next.add(idx);
          });
          return next;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          batch.forEach((i) => next.delete(i));
          return next;
        });
        setRevealing((prev) => {
          const next = new Set(prev);
          batch.forEach((i) => next.delete(i));
          return next;
        });

        totalSkipped += result.skipped_count ?? 0;
        processed += batch.length;
        if (batches.length > 1) setRevealProgress({ done: processed, total: indices.length });
      }

      if (totalSkipped > 0) {
        setRevealNotice(`${totalSkipped} of ${indices.length} skipped — not enough credits to reveal them too.`);
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : `${field === "email" ? "Email" : "Phone"} reveal failed`;
        setRevealError(
          processed > 0
            ? `${message} (${processed} of ${indices.length} already revealed before this failed.)`
            : message,
        );
      }
    } finally {
      if (mountedRef.current) {
        setRevealing((prev) => {
          const next = new Set(prev);
          indices.forEach((i) => next.delete(i));
          return next;
        });
        setRevealProgress(null);
      }
    }
  }

  // What the bulk buttons will actually reveal/bill for — excludes rows in
  // the selection that already show a value, matching the skip in reveal()
  // so the credit estimate on the button never overstates the real charge.
  const pendingEmailCount = Array.from(selected).filter((i) => !people[i]?.Email).length;
  const pendingPhoneCount = Array.from(selected).filter((i) => !people[i]?.Phone).length;

  const findButton = (
    <Button type="submit" variant="primary" className="w-100" disabled={!canSearch || loading || revealBusy}>
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
        <h1 className="h4 mb-3 text-primary">LinkedIn Lookup</h1>

        <Nav variant="tabs" className="mb-4">
          <Nav.Item>
            <Nav.Link active={tab === "lookup"} onClick={() => selectTab("lookup")} role="button">
              Lookup Manually
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link
              active={tab === "extension"}
              onClick={() => selectTab("extension")}
              role="button"
              className="d-flex align-items-center gap-2"
            >
              Chrome Extension
              <Badge bg="success">NEW</Badge>
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {tab === "extension" && <ChromeExtensionPanel />}

        {/*
          Hidden rather than unmounted. A reveal in flight keeps running and
          still bills credits after unmount, but the mountedRef guards in
          reveal() drop the result — so switching tabs mid-reveal would charge
          the user for data they never see. Everything below is also plain
          useState (selection, per-row spinners) and would be lost too.
        */}
        <div className={tab === "lookup" ? undefined : "d-none"}>
        <Row className="g-4">
          <Col xs={12} lg={3}>
            <Card className="shadow-sm border-primary-subtle filter-panel">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <span className="fw-semibold small text-uppercase text-primary">Filters</span>
                  <Button size="sm" variant="outline-secondary" onClick={handleClearFilters}>
                    Clear
                  </Button>
                </div>
                <Form onSubmit={handleSearch}>
                  <TagInput
                    label="LinkedIn URLs"
                    values={urls}
                    onChange={setUrls}
                    placeholder="Paste a profile URL, press Enter"
                  />

                  <div className="cost-note">
                    <p>The lookup itself is always free. Email and phone are revealed on demand:</p>
                    <ul>
                      <li>
                        <span>Reveal email</span>
                        <strong>2 credits</strong>
                      </li>
                      <li>
                        <span>Reveal phone</span>
                        <strong>20 credits</strong>
                      </li>
                      <li>
                        <span>Not found</span>
                        <strong>Free</strong>
                      </li>
                    </ul>
                  </div>

                  {error && <Alert variant="danger">{error}</Alert>}

                  {revealBusy && (
                    <Alert variant="secondary" className="small py-2">
                      Searching is paused until the current reveal finishes.
                    </Alert>
                  )}

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
                  <div className="d-flex align-items-center gap-2">
                    {selected.size > 0 && (
                      <>
                        <span className="small text-body-secondary">{selected.size} selected</span>
                        {pendingEmailCount > 0 && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={revealingEmailRows.size > 0}
                            onClick={() => reveal(Array.from(selected).sort((a, b) => a - b), "email")}
                          >
                            {revealingEmailRows.size > 0 ? (
                              <>
                                <Spinner animation="border" size="sm" className="me-1" />
                                {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
                              </>
                            ) : (
                              `Reveal Email (${pendingEmailCount * 2} credits)`
                            )}
                          </Button>
                        )}
                        {pendingPhoneCount > 0 && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={revealingPhoneRows.size > 0}
                            onClick={() => reveal(Array.from(selected).sort((a, b) => a - b), "phone")}
                          >
                            {revealingPhoneRows.size > 0 ? (
                              <>
                                <Spinner animation="border" size="sm" className="me-1" />
                                {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
                              </>
                            ) : (
                              `Reveal Phone (${pendingPhoneCount * 20} credits)`
                            )}
                          </Button>
                        )}
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

                {revealNotice && (
                  <Alert variant="warning" dismissible onClose={() => setRevealNotice(null)}>
                    {revealNotice}
                  </Alert>
                )}

                {!hasSearched && !loading && (
                  <div className="text-center text-body-secondary py-5">
                    <Linkedin size={28} className="mb-2 opacity-50" />
                    <p className="mb-0">Paste one or more LinkedIn URLs and click Search.</p>
                  </div>
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
                          <th style={{ minWidth: 150 }}>Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p, i) => {
                          // Defense in depth: a null/undefined entry should never reach this
                          // array (reveal() only ever writes rows the server actually returned),
                          // but skipping it here rather than crashing the render is a cheap,
                          // permanent guard.
                          if (!p) return null;
                          return (
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
                                ) : notFoundEmailRows.has(i) ? (
                                  <span className="text-body-secondary">Not found</span>
                                ) : (
                                  <Button size="sm" variant="outline-primary" onClick={() => reveal([i], "email")}>
                                    Reveal
                                  </Button>
                                )}
                              </td>
                              <td className="small text-nowrap" style={{ minWidth: 150 }}>
                                {p.Phone ? (
                                  <span>{p.Phone}</span>
                                ) : revealingPhoneRows.has(i) ? (
                                  <Spinner animation="border" size="sm" />
                                ) : notFoundPhoneRows.has(i) ? (
                                  <span className="text-body-secondary">Not found</span>
                                ) : (
                                  <Button size="sm" variant="outline-primary" onClick={() => reveal([i], "phone")}>
                                    Reveal
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
        </div>
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

      <ToastContainer position="bottom-end" containerPosition="fixed" className="p-3">
        <Toast bg="danger" show={!!revealError} onClose={() => setRevealError(null)} delay={6000} autohide>
          <Toast.Header closeVariant="white">
            <strong className="me-auto">Reveal failed</strong>
          </Toast.Header>
          <Toast.Body className="text-white">{revealError}</Toast.Body>
        </Toast>
      </ToastContainer>
    </AppLayout>
  );
}
