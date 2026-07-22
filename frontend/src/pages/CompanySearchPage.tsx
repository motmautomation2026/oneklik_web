import { useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Dropdown,
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

const SIZE_OPTIONS = [
  "1-10",
  "11-20",
  "21-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-2000",
  "2001-5000",
  "5001-10000",
  "10000+",
];

async function fetchProspeoSuggestions(type: "industry" | "location", query: string): Promise<string[]> {
  const result = await apiPost<{ suggestions: string[] }>("/api/prospeo/suggestions", { query, type });
  return result.suggestions;
}

const fetchIndustrySuggestions = (query: string) => fetchProspeoSuggestions("industry", query);
const fetchLocationSuggestions = (query: string) => fetchProspeoSuggestions("location", query);

function SizeDropdown({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    onChange(values.includes(opt) ? values.filter((v) => v !== opt) : [...values, opt]);
  }

  return (
    <Dropdown autoClose="outside">
      <Dropdown.Toggle variant="outline-primary" size="sm" className="w-100 text-start">
        {values.length > 0 ? `${values.length} selected` : "Any size"}
      </Dropdown.Toggle>
      <Dropdown.Menu className="w-100" style={{ maxHeight: 260, overflowY: "auto" }}>
        {SIZE_OPTIONS.map((opt) => (
          <div
            key={opt}
            className="dropdown-item d-flex align-items-center gap-2"
            role="button"
            onClick={() => toggle(opt)}
          >
            <input
              type="checkbox"
              className="form-check-input mt-0"
              checked={values.includes(opt)}
              readOnly
            />
            <span>{opt}</span>
          </div>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

interface Company {
  Company: string;
  Website: string;
  Location: string;
  Industry: string;
  Headcount: string;
  Phone: string;
  LinkedIn: string;
}

function creditsForCount(count: number): number {
  return Math.max(1, Math.ceil(count / 25));
}

export default function CompanySearchPage() {
  const { user } = useAuth();

  const [industries, setIndustries] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>(["India"]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [companyCount, setCompanyCount] = useState(10);

  const [aiMode, setAiMode] = useState(false);
  const [sentence, setSentence] = useState("");

  const [companies, setCompanies] = useState<Company[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [listName, setListName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canSearch = industries.length > 0 || locations.length > 0;

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiPost<{ companies: Company[] }>("/api/hv/company-search", {
        industries,
        locations,
        company_size: sizes,
        company_count: companyCount,
      });
      setCompanies(result.companies);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAiSearch(e: FormEvent) {
    e.preventDefault();
    if (!sentence.trim()) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiPost<{ companies: Company[] }>("/api/hv/company-search-ai", {
        sentence: sentence.trim(),
      });
      setCompanies(result.companies);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI search failed");
    } finally {
      setLoading(false);
    }
  }

  function openSaveModal() {
    setListName(`Company Search — ${new Date().toLocaleDateString()}`);
    setSaveError(null);
    setShowSaveModal(true);
  }

  async function handleSaveList() {
    if (!user || companies.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data: list, error: listError } = await supabase
        .from("lists")
        .insert({ user_id: user.id, name: listName.trim() || "Company Search", kind: "company" })
        .select("id")
        .single();
      if (listError || !list) throw new Error(listError?.message || "Could not create list");

      const rows = companies.map((c) => ({
        list_id: list.id,
        user_id: user.id,
        data: c,
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

  const findButton = (
    <Button type="submit" variant="primary" className="w-100" disabled={!canSearch || loading}>
      {loading ? (
        <>
          <Spinner animation="border" size="sm" className="me-2" />
          Searching…
        </>
      ) : (
        "Find Companies"
      )}
    </Button>
  );

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">Company Search</h1>
        <Row className="g-4">
          <Col xs={12} lg={3}>
            <Card className="shadow-sm border-primary-subtle filter-panel">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <span className="fw-semibold small text-uppercase text-primary">Filters</span>
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

                {aiMode ? (
                  <Form onSubmit={handleAiSearch}>
                    <Form.Group className="mb-3">
                      <Form.Label className="fw-semibold small text-uppercase text-primary">
                        Describe what you need
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={5}
                        placeholder="e.g. Automotive companies in Pune with 500+ employees"
                        value={sentence}
                        onChange={(e) => setSentence(e.target.value)}
                      />
                      <Form.Text>Up to 25 companies · 1 credit if anything is found, free otherwise.</Form.Text>
                    </Form.Group>

                    {error && <Alert variant="danger">{error}</Alert>}

                    <Button type="submit" variant="primary" className="w-100" disabled={!sentence.trim() || loading}>
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
                      label="Industry"
                      values={industries}
                      onChange={setIndustries}
                      placeholder="Type an industry, press Enter"
                      fetchSuggestions={fetchIndustrySuggestions}
                    />

                    <TagInput
                      label="Location"
                      values={locations}
                      onChange={setLocations}
                      placeholder="Add a location, press Enter"
                      fetchSuggestions={fetchLocationSuggestions}
                    />

                    <fieldset className="mb-3">
                      <Form.Label className="fw-semibold small text-uppercase text-primary">
                        Company size
                      </Form.Label>
                      <SizeDropdown values={sizes} onChange={setSizes} />
                    </fieldset>

                    <ClampedNumberInput
                      label="Companies to fetch"
                      value={companyCount}
                      onChange={setCompanyCount}
                      min={1}
                      max={100}
                      helpText={
                        <>
                          Estimated cost: <strong>{creditsForCount(companyCount)}</strong> credit
                          {creditsForCount(companyCount) > 1 ? "s" : ""}
                        </>
                      }
                    />

                    {error && <Alert variant="danger">{error}</Alert>}

                    {canSearch ? (
                      findButton
                    ) : (
                      <OverlayTrigger overlay={<Tooltip>Pick at least one industry or location</Tooltip>}>
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
                    Companies
                    {hasSearched && <Badge bg="primary">{companies.length}</Badge>}
                  </h2>
                  {companies.length > 0 && (
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

                {!hasSearched && !loading && (
                  <p className="text-body-secondary">
                    {aiMode
                      ? "Describe what you're looking for and click Search."
                      : "Set your filters and click Find Companies to get started."}
                  </p>
                )}

                {loading && (
                  <div className="text-center py-5">
                    <Spinner animation="border" variant="primary" />
                  </div>
                )}

                {hasSearched && !loading && companies.length === 0 && (
                  <p className="text-body-secondary">No companies matched those filters.</p>
                )}

                {companies.length > 0 && (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Website</th>
                          <th>Location</th>
                          <th>Industry</th>
                          <th>Headcount</th>
                          <th>Phone</th>
                          <th>LinkedIn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companies.map((c, i) => (
                          <tr key={i}>
                            <td className="fw-semibold">{c.Company}</td>
                            <td>
                              {c.Website || (
                                <span title="No website found" className="text-warning">
                                  ⚠
                                </span>
                              )}
                            </td>
                            <td className="text-truncate" style={{ maxWidth: 220 }}>
                              {c.Location}
                            </td>
                            <td>{c.Industry}</td>
                            <td>{c.Headcount}</td>
                            <td>{c.Phone}</td>
                            <td>
                              {c.LinkedIn && (
                                <a href={c.LinkedIn} target="_blank" rel="noreferrer">
                                  View
                                </a>
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
