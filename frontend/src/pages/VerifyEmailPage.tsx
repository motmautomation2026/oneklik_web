import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const stateEmail = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(stateEmail);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "signup",
    });
    setSubmitting(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    navigate("/onboarding", { replace: true });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
      <Card style={{ maxWidth: 420, width: "100%" }} className="p-4 shadow-sm text-center">
        <Card.Body>
          <h1 className="h4 mb-3">Check your inbox</h1>
          <p className="text-body-secondary">
            We've sent a verification email. Click the link inside it, or enter the 6-digit code from that
            same email below.
          </p>

          {error && <Alert variant="danger">{error}</Alert>}

          <Form onSubmit={handleVerify} className="text-start mt-3">
            <Form.Group className="mb-3" controlId="verifyEmail">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="verifyCode">
              <Form.Label>Verification code</Form.Label>
              <Form.Control
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Form.Group>
            <Button type="submit" className="w-100" disabled={submitting || code.length !== 6 || !email}>
              {submitting ? "Verifying…" : "Verify code"}
            </Button>
          </Form>

          <Button variant="outline-secondary" onClick={handleSignOut} className="mt-3">
            Use a different account
          </Button>
        </Card.Body>
      </Card>
    </Container>
  );
}
