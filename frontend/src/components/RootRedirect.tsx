import { Navigate } from "react-router-dom";
import { Container, Spinner } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";

// Used for unmatched paths (App.tsx's catch-all `*` route) — this is also
// where a Google OAuth login lands (redirectTo is the site root, not
// LoginPage, so LoginPage's post-sign-in admin check never runs for that
// path). Mirrors RequireAuth's session/verification checks, then sends
// admins to /admin and everyone else to /dashboard. Deliberately not used
// for the /dashboard route itself, so "Exit to app" from the admin console
// keeps working rather than bouncing straight back.
export default function RootRedirect() {
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
  if (profile?.is_admin) return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}
