import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form } from "react-bootstrap";
import { supabase } from "../lib/supabaseClient";
import { authErrorMessage } from "../lib/authErrorMessage";
import AuthLayout from "../components/AuthLayout";

const RESEND_COOLDOWN_SECONDS = 60;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const stateEmail = (location.state as { email?: string } | null)?.email ?? "";

  const [email, setEmail] = useState(stateEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // `verified` remembers that verifyOtp already consumed the code and
  // established a recovery session. If updateUser then fails (e.g. the server
  // rejects the new password), the user can fix it and resubmit without
  // re-entering a now-spent code — we skip straight to updateUser.
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const passwordsMatch = password === confirm;
  const passwordValid = password.length >= 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!passwordValid) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    // Exchange the emailed code for a recovery session (once). Skipped on a
    // retry where verification already succeeded but the password update did
    // not — the code is single-use, but the session it created persists.
    if (!verified) {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: "recovery",
      });
      if (verifyError) {
        setSubmitting(false);
        setError(authErrorMessage(verifyError));
        return;
      }
      setVerified(true);
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(authErrorMessage(updateError));
      return;
    }

    // verifyOtp signed the user in; send them through the catch-all redirect,
    // which routes admins to /admin and everyone else to /dashboard (matching
    // the OAuth-login path) rather than duplicating that logic here.
    navigate("/", { replace: true });
  }

  async function handleResend() {
    if (cooldown > 0 || resending || !email) return;
    setError(null);
    setNotice(null);
    setResending(true);
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(email);
    setResending(false);
    if (resendError) {
      setError(authErrorMessage(resendError));
      return;
    }
    setNotice("If an account exists for that email, a new code is on its way.");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function handleCancel() {
    // Discard any recovery session established by a successful verifyOtp so a
    // half-finished reset never leaves the browser signed in.
    if (verified) await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <AuthLayout>
      <Card style={{ maxWidth: 420, width: "100%" }} className="p-4 shadow-sm">
        <Card.Body>
          <h1 className="h4 mb-3">Set a new password</h1>
          <p className="text-body-secondary">
            Enter the 6-digit code we emailed you, then choose a new password.
          </p>

          {error && <Alert variant="danger">{error}</Alert>}
          {notice && <Alert variant="success">{notice}</Alert>}

          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="resetEmail">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="resetCode">
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
            <Form.Group className="mb-3" controlId="resetPassword">
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
            <Form.Group className="mb-3" controlId="resetConfirm">
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
              className="w-100 mb-2"
              disabled={submitting || code.length !== 6 || !email || !passwordValid || !passwordsMatch}
            >
              {submitting ? "Resetting…" : "Reset password"}
            </Button>
          </Form>

          <div className="d-flex justify-content-between align-items-center small">
            <Button
              variant="link"
              className="p-0"
              onClick={handleResend}
              disabled={cooldown > 0 || resending || !email}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : resending ? "Sending…" : "Resend code"}
            </Button>
            <Button variant="link" className="p-0" onClick={handleCancel}>
              Cancel
            </Button>
          </div>

          <p className="text-center small mb-0 mt-2">
            Didn't request this? <Link to="/login">Back to log in</Link>
          </p>
        </Card.Body>
      </Card>
    </AuthLayout>
  );
}
