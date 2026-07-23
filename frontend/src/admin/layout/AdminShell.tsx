import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Container } from "react-bootstrap";
import AdminSidebar from "./AdminSidebar";
import AdminTopbar from "./AdminTopbar";

// Self-contained admin shell — sidebar + topbar + <Outlet/> for the three
// admin routes. Deliberately does not import AppLayout or the product
// Sidebar: the v1 admin dashboard wrapped AppLayout, which is why product
// nav (Company Search, Lists, Buy Credits, ...) was bleeding into /admin.
export default function AdminShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="d-flex min-vh-100 bg-white">
      <AdminSidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-grow-1 d-flex flex-column" style={{ minWidth: 0 }}>
        <AdminTopbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <div className="flex-grow-1 bg-light">
          <Container fluid className="py-4 px-3 px-md-4">
            <Outlet />
          </Container>
        </div>
      </div>
    </div>
  );
}
