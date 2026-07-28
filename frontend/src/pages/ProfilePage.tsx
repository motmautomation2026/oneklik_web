import { useNavigate } from "react-router-dom";
import { Card, Col, Container, Row } from "react-bootstrap";
import AppLayout from "../components/AppLayout";
import ChangePasswordCard from "../components/ChangePasswordCard";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0];
  return local.slice(0, 2).toUpperCase();
}

function fieldOrFallback(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "Not provided";
}

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 mb-4 text-primary">Profile</h1>

        <Row className="g-4">
          <Col xs={12} md={8} lg={6}>
            <Card className="shadow-sm">
              <Card.Body>
                <div className="d-flex align-items-center gap-3 mb-4">
                  <div className="app-avatar" style={{ width: 56, height: 56, fontSize: "1.1rem" }}>
                    {initialsFromEmail(user?.email)}
                  </div>
                  <div>
                    <div className="fw-semibold">{user?.email}</div>
                    {user?.created_at && (
                      <div className="text-body-secondary small">
                        Member since {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                <dl className="row mb-0">
                  <dt className="col-sm-4 text-body-secondary fw-normal">Email</dt>
                  <dd className="col-sm-8">{user?.email}</dd>

                  <dt className="col-sm-4 text-body-secondary fw-normal">Company</dt>
                  <dd className="col-sm-8">{fieldOrFallback(profile?.company)}</dd>

                  <dt className="col-sm-4 text-body-secondary fw-normal">Role</dt>
                  <dd className="col-sm-8">{fieldOrFallback(profile?.role)}</dd>

                  <dt className="col-sm-4 text-body-secondary fw-normal">Use case</dt>
                  <dd className="col-sm-8 mb-0">{fieldOrFallback(profile?.use_case)}</dd>
                </dl>
              </Card.Body>
            </Card>

            <ChangePasswordCard />

            <button className="btn btn-outline-danger btn-sm mt-3" onClick={handleSignOut}>
              Sign out
            </button>
          </Col>
        </Row>
      </Container>
    </AppLayout>
  );
}
