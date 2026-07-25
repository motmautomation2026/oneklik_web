import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setSubmitting(false);

    // Only surface genuine server-side failures (5xx / rate limiting).
    // A missing account is NOT treated as an error here: Supabase returns
    // success regardless, and we deliberately keep it that way to avoid
    // leaking which emails have accounts (account enumeration). Everyone who
    // submits a syntactically valid email is sent on to the reset step with a
    // neutral message — a non-existent address simply never receives a code.
    if (error) {
      setError(authErrorMessage(error));
      return;
    }

    navigate("/reset-password", { state: { email } });
  }

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
      <Card style={{ maxWidth: 420, width: "100%" }} className="p-4 shadow-sm">
        <Card.Body>
          <h1 className="h4 mb-3">Reset your password</h1>
          <p className="text-body-secondary">
            Enter the email for your account and we'll send you a 6-digit code to reset your password.
          </p>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="forgotEmail">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" className="w-100 mb-2" disabled={submitting}>
              {submitting ? "Sending code…" : "Send reset code"}
            </Button>
          </Form>
          <p className="text-center small mb-0">
            Remembered it? <Link to="/login">Back to log in</Link>
          </p>
        </Card.Body>
      </Card>
    </Container>
  );
}
