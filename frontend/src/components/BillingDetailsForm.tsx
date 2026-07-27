import { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Row, Spinner } from "react-bootstrap";
import { apiGet, apiPut } from "../lib/api";

export interface BillingProfile {
  legal_name: string;
  entity_type: "business" | "individual";
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_code: string;
  state_name: string;
  postal_code: string;
  country: string;
}

interface StateOption {
  code: string;
  name: string;
}

interface Props {
  initial?: BillingProfile | null;
  submitLabel?: string;
  onSaved: (profile: BillingProfile) => void;
  onCancel?: () => void;
}

const empty: BillingProfile = {
  legal_name: "",
  entity_type: "business",
  gstin: null,
  address_line1: "",
  address_line2: null,
  city: "",
  state_code: "",
  state_name: "",
  postal_code: "",
  country: "IN",
};

export default function BillingDetailsForm({ initial, submitLabel = "Save billing details", onSaved, onCancel }: Props) {
  const [form, setForm] = useState<BillingProfile>(initial ?? empty);
  const [states, setStates] = useState<StateOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState(true);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  useEffect(() => {
    apiGet<{ states: StateOption[] }>("/api/billing/states")
      .then((res) => setStates(res.states))
      .catch(() => setError("Could not load state list"))
      .finally(() => setLoadingStates(false));
  }, []);

  function update<K extends keyof BillingProfile>(key: K, value: BillingProfile[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onGstinChange(raw: string) {
    const gstin = raw.trim().toUpperCase();
    update("gstin", gstin || null);
    if (gstin.length >= 2) {
      const code = gstin.slice(0, 2);
      const match = states.find((s) => s.code === code);
      if (match) {
        setForm((prev) => ({ ...prev, gstin: gstin || null, state_code: match.code, state_name: match.name }));
      }
    }
  }

  function onStateChange(code: string) {
    const match = states.find((s) => s.code === code);
    setForm((prev) => ({
      ...prev,
      state_code: code,
      state_name: match?.name ?? prev.state_name,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await apiPut<{ profile: BillingProfile }>("/api/billing/profile", {
        ...form,
        gstin: form.gstin?.trim() ? form.gstin.trim().toUpperCase() : null,
        address_line2: form.address_line2?.trim() ? form.address_line2.trim() : null,
      });
      onSaved(res.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save billing details");
    } finally {
      setSaving(false);
    }
  }

  if (loadingStates) {
    return (
      <div className="text-center py-3">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }

  return (
    <Form onSubmit={handleSubmit}>
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Row className="g-3">
        <Col xs={12}>
          <Form.Label>Legal name</Form.Label>
          <Form.Control
            required
            value={form.legal_name}
            onChange={(e) => update("legal_name", e.target.value)}
            placeholder="Name as on GST / bank records"
          />
        </Col>
        <Col xs={12} md={6}>
          <Form.Label>Entity type</Form.Label>
          <Form.Select
            value={form.entity_type}
            onChange={(e) => update("entity_type", e.target.value as "business" | "individual")}
          >
            <option value="business">Business</option>
            <option value="individual">Individual</option>
          </Form.Select>
        </Col>
        <Col xs={12} md={6}>
          <Form.Label>GSTIN (optional)</Form.Label>
          <Form.Control
            value={form.gstin ?? ""}
            onChange={(e) => onGstinChange(e.target.value)}
            placeholder="22AAAAA0000A1Z5"
            maxLength={15}
          />
          <Form.Text muted>Required for businesses that need input tax credit.</Form.Text>
        </Col>
        <Col xs={12}>
          <Form.Label>Address line 1</Form.Label>
          <Form.Control required value={form.address_line1} onChange={(e) => update("address_line1", e.target.value)} />
        </Col>
        <Col xs={12}>
          <Form.Label>Address line 2</Form.Label>
          <Form.Control value={form.address_line2 ?? ""} onChange={(e) => update("address_line2", e.target.value || null)} />
        </Col>
        <Col xs={12} md={4}>
          <Form.Label>City</Form.Label>
          <Form.Control required value={form.city} onChange={(e) => update("city", e.target.value)} />
        </Col>
        <Col xs={12} md={4}>
          <Form.Label>State</Form.Label>
          <Form.Select required value={form.state_code} onChange={(e) => onStateChange(e.target.value)}>
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Form.Select>
        </Col>
        <Col xs={12} md={4}>
          <Form.Label>Postal code</Form.Label>
          <Form.Control required value={form.postal_code} onChange={(e) => update("postal_code", e.target.value)} />
        </Col>
      </Row>

      <div className="d-flex gap-2 justify-content-end mt-4">
        {onCancel && (
          <Button type="button" variant="outline-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </Form>
  );
}
