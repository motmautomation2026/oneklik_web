import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Container, Spinner } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";

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
  if (requireOnboarded && profile && !profile.company) return <Navigate to="/onboarding" replace />;

  return <>{children}</>;
}
