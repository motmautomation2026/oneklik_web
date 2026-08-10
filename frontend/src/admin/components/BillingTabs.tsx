import { NavLink } from "react-router-dom";
import { ADMIN_CHART_COLORS } from "../theme";

// Shared header for the three billing pages (Transactions, Invoices,
// Subscriptions). They stay separate routes/components on purpose — each
// has its own KPIs, filters, and API calls — this just gives them one
// consistent "Billing" identity and an in-page tab strip to move between
// them, mirroring the merged sidebar entry in AdminSidebar.
const BILLING_TABS = [
  { to: "/admin/transactions", label: "Transactions" },
  { to: "/admin/invoices", label: "Invoices" },
  { to: "/admin/subscriptions", label: "Subscriptions" },
];

export default function BillingTabs() {
  return (
    <div className="mb-4">
      <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
        Billing
      </h1>
      <p className="mb-3 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
        All transactions, invoices, and subscriptions in one place.
      </p>
      <div className="admin-billing-tabs">
        {BILLING_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `admin-billing-tab${isActive ? " active" : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
