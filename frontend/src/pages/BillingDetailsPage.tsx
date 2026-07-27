import { useEffect, useState } from "react";
import { Alert, Card, Container, Spinner } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import BillingDetailsForm, { type BillingProfile } from "../components/BillingDetailsForm";
import { apiGet } from "../lib/api";

export default function BillingDetailsPage() {
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiGet<{ profile: BillingProfile | null }>("/api/billing/profile")
      .then((res) => setProfile(res.profile))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load billing details"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4" style={{ maxWidth: 720 }}>
        <h1 className="h4 mb-1 text-primary">Billing details</h1>
        <p className="text-body-secondary small mb-4">
          Used on future receipts. Changing these details does not alter receipts already issued.
        </p>

        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert variant="success" dismissible onClose={() => setSaved(false)}>
            Billing details saved.
          </Alert>
        )}

        <Card className="shadow-sm">
          <Card.Body>
            {loading ? (
              <div className="text-center py-4">
                <Spinner animation="border" size="sm" />
              </div>
            ) : (
              <BillingDetailsForm
                initial={profile}
                onSaved={(next) => {
                  setProfile(next);
                  setSaved(true);
                }}
              />
            )}
          </Card.Body>
        </Card>
      </Container>
    </AppLayout>
  );
}
