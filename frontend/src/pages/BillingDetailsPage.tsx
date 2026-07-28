import { Navigate } from "react-router-dom";

/** Legacy /billing/details → Billing hub details tab */
export default function BillingDetailsPage() {
  return <Navigate to="/billing?tab=details" replace />;
}
