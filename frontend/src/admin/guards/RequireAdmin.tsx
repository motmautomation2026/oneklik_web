import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Container, Spinner } from "react-bootstrap";
import { useAuth } from "../../lib/AuthProvider";

// Mirrors RequireAuth's loading/redirect pattern. This is a UX convenience
// only — the real enforcement is the backend's requireAdmin middleware plus
// Postgres RLS, both independent of this component, so it never carries any
// data-access responsibility of its own.
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!profile?.is_admin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
