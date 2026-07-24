import { useState, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  ChevronDoubleLeft,
  ChevronDoubleRight,
  PeopleFill,
  Receipt,
  Speedometer2,
  X,
} from "react-bootstrap-icons";

interface AdminNavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
}

// Deliberately not derived from or shared with the product Sidebar
// (components/Sidebar.tsx). The admin console is a different surface with a
// different audience; it must never inherit product nav items (Company
// Search, Lists, Buy Credits, ...). The original three items keep their
// position — Runs is appended, not interleaved. (Flagged accounts was
// removed as a dedicated section per explicit request; per-user flag review
// still lives on AdminUserDetailPage.) Lists has no nav entry on purpose —
// it's only reachable via a user's detail page ("View all lists →"), the
// route at /admin/lists still exists and works, it's just not in the sidebar.
const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: Speedometer2, end: true },
  { to: "/admin/users", label: "Users", icon: PeopleFill },
  { to: "/admin/transactions", label: "Transactions", icon: Receipt },
  { to: "/admin/runs", label: "Runs", icon: Activity },
];

const STORAGE_KEY = "one-klik-admin-sidebar-collapsed";

interface AdminSidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ mobileOpen, onClose }: AdminSidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      {mobileOpen && <div className="app-sidebar-backdrop" onClick={onClose} />}
      <aside className={`app-sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
        <div className="app-sidebar-header">
          <Link to="/admin" className="app-sidebar-brand" onClick={onClose}>
            <span className="app-sidebar-brand-full">One-Klik Admin</span>
            <span className="app-sidebar-brand-short">OK</span>
          </Link>
          <button
            type="button"
            className="app-sidebar-toggle d-none d-md-flex"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronDoubleRight size={14} /> : <ChevronDoubleLeft size={14} />}
          </button>
          <button
            type="button"
            className="app-sidebar-toggle d-md-none"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="app-sidebar-nav">
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`app-sidebar-link${isActive ? " active" : ""}`}
                onClick={onClose}
              >
                <Icon size={18} />
                <span className="app-sidebar-link-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
