import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";

export default function ChangePasswordCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch = password === confirm;
  const passwordValid = password.length >= 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!user?.email) {
      setError("You must be signed in to change your password.");
      return;
    }
    if (!passwordValid) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (!passwordsMatch) {
      setError("New passwords do not match.");
      return;
    }
    if (password === current) {
      setError("Your new password must be different from your current one.");
      return;
    }

    setSubmitting(true);

    // Supabase's updateUser({ password }) does not re-check the existing
    // password, so we verify it ourselves first by re-authenticating. This
    // signs the same user back in (refreshing, not replacing, their session)
    // and fails cleanly if the current password is wrong — closing the hole
    // where anyone with an open session could silently reset the password.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (verifyError) {
      setSubmitting(false);
      setError(
        verifyError.status && verifyError.status >= 500
          ? authErrorMessage(verifyError)
          : "Current password is incorrect."
      );
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }

    setSuccess("Your password has been updated.");
    setCurrent("");
    setPassword("");
    setConfirm("");
  }

  return (
    <Card className="shadow-sm mt-4">
      <Card.Body>
        <h2 className="h5 mb-3">Change password</h2>

        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3" controlId="currentPassword">
            <Form.Label>Current password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Form.Group>
          <Form.Group className="mb-3" controlId="newPassword">
            <Form.Label>New password</Form.Label>
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
          <Form.Group className="mb-3" controlId="confirmNewPassword">
            <Form.Label>Confirm new password</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              isInvalid={confirm.length > 0 && !passwordsMatch}
              required
            />
            <Form.Control.Feedback type="invalid">Passwords do not match.</Form.Control.Feedback>
          </Form.Group>
          <Button
            type="submit"
            disabled={submitting || !current || !passwordValid || !passwordsMatch}
          >
            {submitting ? "Updating…" : "Update password"}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}
