import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  Toast,
  ToastContainer,
  Tooltip,
} from "react-bootstrap";
import { Search } from "react-bootstrap-icons";
import AppLayout from "../components/AppLayout";
import TagInput from "../components/TagInput";
import ClampedNumberInput from "../components/ClampedNumberInput";
import { apiPost } from "../lib/api";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import { normalizeDomain } from "../lib/domain";
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

function creditsForCount(count: number): number {
  return Math.max(1, Math.ceil(count / 25));
}

// Mirrors the backend's MAX_TOTAL_PEOPLE (peopleSearch.ts) and
// MAX_ROWS_PER_REQUEST (revealFlow.ts) — kept as named constants here so the
// two limits this page enforces (search size, reveal batch size) can't drift
// out of sync with what the server actually allows.
const TOTAL_PEOPLE_CAP = 200;
const MIN_COUNT_PER_COMPANY = 5;
const ABSOLUTE_MAX_COUNT_PER_COMPANY = 50;
const REVEAL_BATCH_SIZE = 50;

// More domains means less headroom per domain, so the per-company cap
// shrinks as you add domains instead of letting the total silently blow
// past what the search endpoint will actually return.
function maxCountPerCompany(domainCount: number): number {
  if (domainCount <= 0) return ABSOLUTE_MAX_COUNT_PER_COMPANY;
  return Math.min(ABSOLUTE_MAX_COUNT_PER_COMPANY, Math.max(MIN_COUNT_PER_COMPANY, Math.floor(TOTAL_PEOPLE_CAP / domainCount)));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function fetchProspeoSuggestions(type: "location" | "job_title", query: string): Promise<string[]> {
  const result = await apiPost<{ suggestions: string[] }>("/api/prospeo/suggestions", { query, type });
  return result.suggestions;
}

const fetchLocationSuggestions = (query: string) => fetchProspeoSuggestions("location", query);
const fetchJobTitleSuggestions = (query: string) => fetchProspeoSuggestions("job_title", query);

export default function PeopleSearchPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [domains, setDomains] = useSessionStorageState<string[]>("peopleSearch.domains", []);
  const [jobTitles, setJobTitles] = useSessionStorageState<string[]>("peopleSearch.jobTitles", []);
  const [locations, setLocations] = useSessionStorageState<string[]>("peopleSearch.locations", []);
  const [countPerCompany, setCountPerCompany] = useSessionStorageState("peopleSearch.countPerCompany", 10);

  const [aiMode, setAiMode] = useSessionStorageState("peopleSearch.aiMode", false);
  const [sentence, setSentence] = useSessionStorageState("peopleSearch.sentence", "");

  const [people, setPeople] = useSessionStorageState<Person[]>("peopleSearch.people", []);
  const [hasSearched, setHasSearched] = useSessionStorageState("peopleSearch.hasSearched", false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);

  // Consumes companies handed over from Company Search's "Search the people"
  // button (router state), then clears the state so back/refresh doesn't
  // silently re-apply it.
  useEffect(() => {
    const incoming = (location.state as { domains?: string[] } | null)?.domains;
    if (incoming && incoming.length > 0) {
      setDomains(incoming);
      setPrefillNotice(
        `Showing people for ${incoming.length} compan${incoming.length === 1 ? "y" : "ies"} from your last company search.`,
      );
      navigate(location.pathname, { replace: true, state: null });
    }
    // Runs once on mount only — deliberately ignores location/navigate identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const canSearch = domains.length > 0;
  const countPerCompanyLimit = maxCountPerCompany(domains.length);
  const maxTotal = Math.min(domains.length * countPerCompany, TOTAL_PEOPLE_CAP);

  // Adding more domains can drop the per-company ceiling below whatever the
  // user had previously set — re-clamp so the field never silently holds a
  // value the backend would reject/truncate.
  useEffect(() => {
    if (countPerCompany > countPerCompanyLimit) setCountPerCompany(countPerCompanyLimit);
    // Only the ceiling changing (i.e. domains.length changing) should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countPerCompanyLimit]);

  function handleClearFilters() {
    setDomains([]);
    setJobTitles([]);
    setLocations([]);
    setCountPerCompany(10);
    setSentence("");
    setError(null);
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    // A reveal batch sequence writes into `people` by array index as each
    // batch resolves — running a fresh search (which replaces `people`
    // wholesale) while that's in flight would let a late-arriving batch
    // write stale results into the new, unrelated result set. The Find
    // People button is disabled for this too, but the guard has to live
    // here as well since an Enter keypress inside the form submits it
    // regardless of the button's disabled state.
    if (!canSearch || revealBusy) return;
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
      setNotFoundEmailRows(new Set());
      setNotFoundPhoneRows(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAiSearch(e: FormEvent) {
    e.preventDefault();
    if (!sentence.trim() || revealBusy) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiPost<{ people: Person[] }>("/api/hv/people-search-ai", {
        sentence: sentence.trim(),
      });
      setPeople(result.people);
      setHasSearched(true);
      setNotFoundEmailRows(new Set());
      setNotFoundPhoneRows(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI search failed");
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

  // Sends the selection in sequential batches of REVEAL_BATCH_SIZE rather
  // than one request for the whole selection. This isn't just a size
  // guard: it structurally prevents the bug that took the People page down
  // in production, where a request larger than the server's per-request
  // cap came back with fewer results than were selected, and the old code
  // indexed the (shorter) response against the (longer) selection —
  // writing `undefined` into rows past the cutoff, which crashed every
  // future render of the table. Each batch here is sized to match exactly
  // what the server processes, so response length and selection length can
  // never diverge, and the per-row write below is guarded anyway as a
  // second line of defense. Batches run one at a time (not in parallel) so
  // a large reveal doesn't throw a burst of simultaneous large requests at
  // the enrichment provider.
  async function reveal(indices: number[], field: "email" | "phone") {
    const revealingSet = field === "email" ? revealingEmailRows : revealingPhoneRows;
    if (indices.length === 0 || indices.some((i) => revealingSet.has(i))) return;
    const setRevealing = field === "email" ? setRevealingEmailRows : setRevealingPhoneRows;
    const setNotFound = field === "email" ? setNotFoundEmailRows : setNotFoundPhoneRows;
    const personField = field === "email" ? "Email" : "Phone";
    const endpoint = field === "email" ? "/api/hv/email-reveal" : "/api/hv/phone-reveal";

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
        setRevealNotice(
          `${totalSkipped} of ${indices.length} skipped — not enough credits to reveal them too.`,
        );
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

  const findButton = (
    <Button type="submit" variant="primary" className="w-100" disabled={!canSearch || loading || revealBusy}>
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
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <span className="fw-semibold small text-uppercase text-primary">Filters</span>
                  <div className="d-flex align-items-center gap-2">
                    <Button size="sm" variant="outline-secondary" onClick={handleClearFilters}>
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      variant={aiMode ? "primary" : "outline-primary"}
                      onClick={() => {
                        setAiMode((v) => !v);
                        setError(null);
                      }}
                    >
                      AI Mode
                    </Button>
                  </div>
                </div>

                {aiMode ? (
                  <Form onSubmit={handleAiSearch}>
                    <Form.Group className="mb-3">
                      <Form.Label className="fw-semibold small text-uppercase text-primary">
                        Describe who you need
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={5}
                        placeholder="e.g. VPs of Sales at automotive companies in Pune"
                        value={sentence}
                        onChange={(e) => setSentence(e.target.value)}
                      />
                      <Form.Text>Up to 25 people · 1 credit if anything is found, free otherwise.</Form.Text>
                    </Form.Group>

                    {error && <Alert variant="danger">{error}</Alert>}

                    {revealBusy && (
                      <Alert variant="secondary" className="small py-2">
                        Searching is paused until the current reveal finishes.
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      className="w-100"
                      disabled={!sentence.trim() || loading || revealBusy}
                    >
                      {loading ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Searching…
                        </>
                      ) : (
                        "Search"
                      )}
                    </Button>
                  </Form>
                ) : (
                  <Form onSubmit={handleSearch}>
                    <TagInput
                      label="Company domains"
                      values={domains}
                      onChange={setDomains}
                      placeholder="e.g. zf.com, press Enter"
                      normalize={normalizeDomain}
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
                      max={countPerCompanyLimit}
                      helpText={
                        <>
                          Up to {countPerCompanyLimit} per company with {domains.length || 1} domain
                          {domains.length === 1 ? "" : "s"} added · Up to {maxTotal} people total · Estimated cost:{" "}
                          <strong>{creditsForCount(maxTotal)}</strong> credit{creditsForCount(maxTotal) > 1 ? "s" : ""}
                        </>
                      }
                    />

                    {error && <Alert variant="danger">{error}</Alert>}

                    {revealBusy && (
                      <Alert variant="secondary" className="small py-2">
                        Searching is paused until the current reveal finishes.
                      </Alert>
                    )}

                    {canSearch && !revealBusy ? (
                      findButton
                    ) : (
                      <OverlayTrigger
                        overlay={
                          <Tooltip>
                            {revealBusy ? "Wait for the current reveal to finish" : "Add at least one company domain"}
                          </Tooltip>
                        }
                      >
                        <span className="d-block">{findButton}</span>
                      </OverlayTrigger>
                    )}
                  </Form>
                )}
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
                              {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
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
                              {revealProgress ? `Revealing ${revealProgress.done} of ${revealProgress.total}…` : "Revealing…"}
                            </>
                          ) : (
                            `Reveal Phone (${selected.size * 20} credits)`
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

                {prefillNotice && (
                  <Alert variant="info" dismissible onClose={() => setPrefillNotice(null)}>
                    {prefillNotice}
                  </Alert>
                )}

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
                    <Search size={28} className="mb-2 opacity-50" />
                    <p className="mb-0">
                      {aiMode
                        ? "Describe who you're looking for and click Search."
                        : "Add company domains and click Find People to get started."}
                    </p>
                  </div>
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
                        {people.map((p, i) => {
                          // Defense in depth: a null/undefined entry should never reach this
                          // array anymore (reveal() no longer writes one), but skipping it here
                          // rather than crashing the render is a cheap, permanent guard against
                          // whatever the next unrelated bug turns out to be.
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
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => reveal([i], "email")}
                                >
                                  Reveal
                                </Button>
                              )}
                            </td>
                            <td className="small">
                              {p.Phone ? (
                                <span>{p.Phone}</span>
                              ) : revealingPhoneRows.has(i) ? (
                                <Spinner animation="border" size="sm" />
                              ) : notFoundPhoneRows.has(i) ? (
                                <span className="text-body-secondary">Not found</span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  onClick={() => reveal([i], "phone")}
                                >
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
