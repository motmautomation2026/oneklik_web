import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Container, Spinner } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";
import { isLockedOut } from "../lib/accountStatus";
import AccountLockout from "./AccountLockout";

export default function RequireAuth({
  children,
  requireOnboarded = false,
}: {
  children: ReactNode;
  requireOnboarded?: boolean;
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
  if (profile && isLockedOut(profile.account_status, profile.suspended_until)) {
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
