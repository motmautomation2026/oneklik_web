import { useState } from "react";
import { Button, Card, Container } from "react-bootstrap";
import { ShieldLock } from "react-bootstrap-icons";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

// Optional — set VITE_SUPPORT_EMAIL to surface a mailto link. When unset, the
// screen still tells the user to contact support, just without a hardcoded
// address (we don't invent one).
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;

interface AccountLockoutProps {
  status: "suspended" | "banned";
  reason: string | null;
  suspendedUntil: string | null;
}

// Full-page screen shown by RequireAuth in place of the app when a signed-in
// user is suspended or banned. Deliberately standalone (no sidebar/topbar) —
// a locked-out user gets an explanation and a way out, nothing else. All
// actual access is already blocked server-side; this is the user-facing
// counterpart.
export default function AccountLockout({ status, reason, suspendedUntil }: AccountLockoutProps) {
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      navigate("/login");
    } finally {
      setSigningOut(false);
    }
  }

  const isBanned = status === "banned";
  const title = isBanned ? "Your account has been banned" : "Your account is suspended";
  const lead = isBanned
    ? "Access to your account has been permanently disabled."
    : "Access to your account is temporarily disabled.";

  const untilText =
    !isBanned && suspendedUntil ? new Date(suspendedUntil).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
      <Card className="shadow-sm border-0" style={{ maxWidth: 460 }}>
        <Card.Body className="p-4 text-center">
          <div className={`mb-3 ${isBanned ? "text-danger" : "text-warning"}`}>
            <ShieldLock size={44} />
          </div>
          <h1 className="h5 mb-2">{title}</h1>
          <p className="text-body-secondary mb-3">{lead}</p>

          {reason && (
            <div className="alert alert-light border small text-start mb-3">
              <span className="fw-semibold">Reason:</span> {reason}
            </div>
          )}

          {untilText && (
            <p className="small text-body-secondary mb-3">
              Access is scheduled to be restored on <span className="fw-semibold">{untilText}</span>.
            </p>
          )}

          <p className="small text-body-secondary mb-4">
            If you believe this is a mistake, raise a request and our team will review it
            {SUPPORT_EMAIL ? (
              <>
                {". You can also email us at "}
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </>
            ) : (
              ""
            )}
            .
          </p>

          {/* The primary action on this screen. Reaching it works because the
              /support routes pass allowLockedOut to RequireAuth — every other
              route would bounce straight back to this page. */}
          <div className="d-grid gap-2">
            <Button variant="primary" onClick={() => navigate("/support/new?source=lockout")}>
              Raise a request
            </Button>
            <Button variant="outline-secondary" onClick={() => navigate("/support")}>
              View my requests
            </Button>
            <Button variant="link" className="text-body-secondary" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
}
