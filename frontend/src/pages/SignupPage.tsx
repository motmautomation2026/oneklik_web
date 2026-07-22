import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    navigate("/verify-email", { state: { email } });
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
      <Card style={{ maxWidth: 420, width: "100%" }} className="p-4 shadow-sm">
        <Card.Body>
          <h1 className="h4 mb-3">Create your account</h1>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="signupEmail">
              <Form.Label>Work email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="signupPassword">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Form.Text>At least 8 characters.</Form.Text>
            </Form.Group>
            <Button type="submit" className="w-100 mb-2" disabled={submitting}>
              {submitting ? "Creating account…" : "Sign up"}
            </Button>
          </Form>
          <Button variant="outline-secondary" className="w-100 mb-3" onClick={handleGoogle}>
            Continue with Google
          </Button>
          <p className="text-center small mb-0">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </Card.Body>
      </Card>
    </Container>
  );
}
