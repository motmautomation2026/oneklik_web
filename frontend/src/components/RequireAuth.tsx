import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Container, Spinner } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";
import { isLockedOut } from "../lib/accountStatus";
import AccountLockout from "./AccountLockout";

export default function RequireAuth({
  children,
  requireOnboarded = false,
  allowLockedOut = false,
}: {
  children: ReactNode;
  requireOnboarded?: boolean;
  // Opt-in, used only by the /support routes. Defaults to false so every
  // existing call site keeps exactly the behavior it had before support
  // existed — a locked-out user still sees the lockout screen everywhere else.
  allowLockedOut?: boolean;
}) {
  const { session, user, profile, loading } = useAuth();

  if (loading) {
    return (
      <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (!user?.email_confirmed_at) return <Navigate to="/verify-email" replace />;

  // Suspended/banned users see a lockout screen instead of the app, ahead of
  // the onboarding redirect so a restricted account is never bounced into the
  // onboarding flow. 'frozen' is intentionally not gated here — those users
  // keep read access and get a banner in AppLayout instead. An expired
  // time-boxed suspension is not a lockout (isLockedOut mirrors the backend's
  // lazy-expiry). Enforcement is server-side regardless; this is the
  // user-facing counterpart.
  // The support routes pass allowLockedOut, and deliberately never pass
  // requireOnboarded either: a user who never finished onboarding, or who was
  // restricted midway through it, must still be able to ask us why.
  if (!allowLockedOut && profile && isLockedOut(profile.account_status, profile.suspended_until)) {
    return (
      <AccountLockout
        status={profile.account_status === "banned" ? "banned" : "suspended"}
        reason={profile.status_reason}
        suspendedUntil={profile.suspended_until}
      />
    );
  }

  if (requireOnboarded && profile && !profile.company) return <Navigate to="/onboarding" replace />;

  return <>{children}</>;
}
