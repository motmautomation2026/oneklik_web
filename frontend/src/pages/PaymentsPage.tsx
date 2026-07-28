import { Navigate } from "react-router-dom";

/** Legacy /payments → Billing hub invoices tab */
export default function PaymentsPage() {
  return <Navigate to="/billing" replace />;
}
