import { Link } from "react-router-dom";
import { Container } from "react-bootstrap";
import { useAuth } from "../lib/AuthProvider";
import AppLayout from "../components/AppLayout";

export default function DashboardPage() {
  const { user, profile } = useAuth();

  return (
    <AppLayout>
      <Container className="py-5">
        <h1 className="h3">Welcome{profile?.company ? `, ${profile.company}` : ""}</h1>
        <p className="text-body-secondary mb-4">Signed in as {user?.email}.</p>
        <Link to="/search" className="btn btn-primary">
          Search Companies
        </Link>
      </Container>
    </AppLayout>
  );
}
