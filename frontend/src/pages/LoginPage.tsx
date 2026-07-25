import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Container, Form } from "react-bootstrap";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }

    // Admins land straight in the admin console, not the product dashboard.
    // Checked here (once, right after sign-in) rather than as a standing
    // redirect on DashboardPage itself — a blanket redirect there would also
    // fire when an admin deliberately navigates back via "Exit to app".
    const userId = data.user?.id;
    if (userId) {
      const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
      if (profile?.is_admin) {
        navigate("/admin");
        return;
      }
    }
    navigate("/dashboard");
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
          <h1 className="h4 mb-3">Log in</h1>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="loginEmail">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="loginPassword">
              <div className="d-flex justify-content-between align-items-center">
                <Form.Label className="mb-0">Password</Form.Label>
                <Link to="/forgot-password" className="small">
                  Forgot password?
                </Link>
              </div>
              <Form.Control
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" className="w-100 mb-2" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </Form>
          <Button variant="outline-secondary" className="w-100 mb-3" onClick={handleGoogle}>
            Continue with Google
          </Button>
          <p className="text-center small mb-0">
            Don't have an account? <Link to="/signup">Sign up</Link>
          </p>
        </Card.Body>
      </Card>
    </Container>
  );
}
