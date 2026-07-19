import { useState, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Building,
  ChevronDoubleLeft,
  ChevronDoubleRight,
  Linkedin,
  ListUl,
  People,
  Speedometer2,
  X,
} from "react-bootstrap-icons";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Speedometer2 },
  { to: "/search", label: "Company Search", icon: Building, group: "Search" },
  { to: "/people", label: "People Search", icon: People, group: "Search" },
  { to: "/linkedin-lookup", label: "LinkedIn Lookup", icon: Linkedin, group: "Search" },
  { to: "/lists", label: "Lists", icon: ListUl },
];

const STORAGE_KEY = "one-klik-sidebar-collapsed";

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
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
          <Link to="/dashboard" className="app-sidebar-brand" onClick={onClose}>
            <span className="app-sidebar-brand-full">One-Klik</span>
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
          {NAV_ITEMS.map((item, idx) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.to);
            const showGroupLabel = item.group && NAV_ITEMS[idx - 1]?.group !== item.group;
            return (
              <div key={item.to}>
                {showGroupLabel && <div className="app-sidebar-group-label">{item.group}</div>}
                <Link to={item.to} className={`app-sidebar-link${isActive ? " active" : ""}`} onClick={onClose}>
                  <Icon size={18} />
                  <span className="app-sidebar-link-label">{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
