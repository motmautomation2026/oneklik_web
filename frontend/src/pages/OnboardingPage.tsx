import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form, InputGroup } from "react-bootstrap";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import { localIndianDigits, normalizeIndianMobile } from "../lib/phone";
import AuthLayout from "../components/AuthLayout";

const USE_CASES = ["Sales prospecting", "Recruiting", "Marketing / demand gen", "Investment research", "Other"];

export default function OnboardingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // Pre-filled so a user who onboarded before mobile became mandatory only
  // has to add their number.
  const [company, setCompany] = useState(profile?.company ?? "");
  const [role, setRole] = useState(profile?.role ?? "");
  const [phone, setPhone] = useState(localIndianDigits(profile?.phone));
  const [useCase, setUseCase] = useState(
    profile?.use_case && USE_CASES.includes(profile.use_case) ? profile.use_case : USE_CASES[0],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.company && profile.phone) {
      navigate("/dashboard", { replace: true });
    }
  }, [profile, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const normalizedPhone = normalizeIndianMobile(phone);
    if (!normalizedPhone) {
      setError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("profiles")
      .update({ company, role, use_case: useCase, phone: normalizedPhone })
      .eq("id", user.id);
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    await refreshProfile();
    navigate("/dashboard");
  }

  return (
    <AuthLayout>
      <Card style={{ maxWidth: 460, width: "100%" }} className="p-4 shadow-sm">
        <Card.Body>
          <h1 className="h4 mb-1">Tell us about you</h1>
          <p className="text-body-secondary small mb-4">One quick step before your dashboard.</p>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="onboardingCompany">
              <Form.Label>Company</Form.Label>
              <Form.Control value={company} onChange={(e) => setCompany(e.target.value)} required />
            </Form.Group>
            <Form.Group className="mb-3" controlId="onboardingRole">
              <Form.Label>Your role</Form.Label>
              <Form.Control value={role} onChange={(e) => setRole(e.target.value)} required />
            </Form.Group>
            <Form.Group className="mb-3" controlId="onboardingPhone">
              <Form.Label>Mobile number</Form.Label>
              <InputGroup>
                <InputGroup.Text>+91</InputGroup.Text>
                <Form.Control
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </InputGroup>
            </Form.Group>
            <Form.Group className="mb-4" controlId="onboardingUseCase">
              <Form.Label>What will you use this for?</Form.Label>
              <Form.Select value={useCase} onChange={(e) => setUseCase(e.target.value)}>
                {USE_CASES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Button type="submit" className="w-100" disabled={submitting}>
              {submitting ? "Saving…" : "Continue"}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </AuthLayout>
  );
}
