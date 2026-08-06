import { Link } from "react-router-dom";
import { Card, Col, Container, Row } from "react-bootstrap";
import { Building, CreditCard, EnvelopePaper, Linkedin, ListUl, People } from "react-bootstrap-icons";
import { useAuth } from "../lib/AuthProvider";
import AppLayout from "../components/AppLayout";

const QUICK_LINKS = [
  {
    to: "/search",
    icon: Building,
    label: "Company Search",
    description: "Find companies by industry, location, and size.",
  },
  {
    to: "/people",
    icon: People,
    label: "People Search",
    description: "Find contacts and reveal verified emails and phones.",
  },
  {
    to: "/linkedin-lookup",
    icon: Linkedin,
    label: "LinkedIn Lookup",
    description: "Paste a profile URL to find its email and phone.",
  },
  {
    to: "/email-templates",
    icon: EnvelopePaper,
    label: "Email Templates",
    description: "Generate outreach and marketing email templates.",
  },
  {
    to: "/lists",
    icon: ListUl,
    label: "Lists",
    description: "Your saved searches and enrichment results.",
  },
];

export default function DashboardPage() {
  const { user, profile } = useAuth();

  return (
    <AppLayout>
      <Container fluid className="py-4 px-3 px-md-4">
        <h1 className="h4 text-primary mb-1">Welcome{profile?.company ? `, ${profile.company}` : ""}</h1>
        <p className="text-body-secondary mb-4">Signed in as {user?.email}.</p>

                <Row className="g-3 mb-4">
          {QUICK_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Col xs={12} sm={6} lg={4} key={item.to}>
                <Card as={Link} to={item.to} className="shadow-sm h-100 text-decoration-none dashboard-quick-card">
                  <Card.Body>
                    <div className="dashboard-quick-icon mb-3">
                      <Icon size={20} />
                    </div>
                    <div className="h6 mb-1 text-body">{item.label}</div>
                    <p className="text-body-secondary small mb-0">{item.description}</p>
                  </Card.Body>
                </Card>
              </Col>
            );
          })}
        </Row>

        <Card className="shadow-sm">
          <Card.Body className="d-flex align-items-center justify-content-between flex-wrap gap-3">
            <div>
              <div className="h6 mb-1">Running low on credits?</div>
              <p className="text-body-secondary small mb-0">
                Top up any time — credits never expire and roll over.
              </p>
            </div>
            <Link to="/buy-credits" className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2">
              <CreditCard size={16} />
              Buy Credits
            </Link>
          </Card.Body>
        </Card>
      </Container>
    </AppLayout>
  );
}
