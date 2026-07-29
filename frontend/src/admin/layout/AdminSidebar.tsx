import { useEffect, useState, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  ChevronDoubleLeft,
  ChevronDoubleRight,
  CreditCard2Front,
  FileEarmarkText,
  LifePreserver,
  PeopleFill,
  Receipt,
  Speedometer2,
  X,
} from "react-bootstrap-icons";
import { fetchSupportBadge } from "../api/adminApi";
import logo from "../../assets/oneklik_logo_small.png";

interface AdminNavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  end?: boolean;
  // Only Support sets this. A queue item nobody has answered is the one thing
  // in this console that gets worse the longer it goes unseen, so it is the
  // one nav item that earns a count.
  badge?: boolean;
}

// Polling, not realtime. The count only has to be roughly current — a minute
// of staleness on a support queue costs nothing, and a Supabase realtime
// subscription would be a new dependency and a new socket for one integer.
const BADGE_POLL_MS = 60_000;

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
  { to: "/admin/invoices", label: "Invoices", icon: FileEarmarkText },
  { to: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard2Front },
  { to: "/admin/runs", label: "Runs", icon: Activity },
  { to: "/admin/support", label: "Support", icon: LifePreserver, badge: true },
];

const STORAGE_KEY = "one-klik-admin-sidebar-collapsed";

interface AdminSidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ mobileOpen, onClose }: AdminSidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");
  const [supportCount, setSupportCount] = useState(0);

  // Refetches on navigation as well as on the interval, so answering a ticket
  // updates the badge immediately rather than up to a minute later.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = () => {
      fetchSupportBadge(controller.signal)
        .then((res) => {
          if (active) setSupportCount(res.count);
        })
        // Silent: a failed badge poll must never surface an error banner over
        // the console. The count simply keeps its previous value.
        .catch(() => undefined);
    };

    load();
    const timer = setInterval(load, BADGE_POLL_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [location.pathname]);

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
            <img src={logo} alt="" className="app-sidebar-brand-logo" />
            <span className="app-sidebar-brand-full">One-Klik Admin</span>
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
                {item.badge && supportCount > 0 && (
                  <span className="app-sidebar-badge" title={`${supportCount} awaiting a reply`}>
                    {supportCount > 99 ? "99+" : supportCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
