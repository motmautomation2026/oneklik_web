import { Button, Card, Container } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function VerifyEmailPage() {
  const navigate = useNavigate();

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
            We've sent a verification link to your email. Click it to activate your account and claim your
            starter credits.
          </p>
          <Button variant="outline-secondary" onClick={handleSignOut} className="mt-2">
            Use a different account
          </Button>
        </Card.Body>
      </Card>
    </Container>
  );
}
