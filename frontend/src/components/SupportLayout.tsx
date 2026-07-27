import type { ReactNode } from "react";
import { Container } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthProvider";
import { isLockedOut } from "../lib/accountStatus";
import AppLayout from "./AppLayout";

// Support is the one surface a locked-out user can still reach, so it needs two
// different sets of chrome:
//
//   active / frozen  — the normal app shell. They still have a product to use,
//                      and support is just another page in it.
//   suspended /      — a standalone shell. AppLayout renders the product
//   banned             sidebar (Company Search, Lists, Buy Credits…), and
//                      offering that navigation to someone who is locked out of
//                      all of it would be actively misleading.
//
// The decision uses the same isLockedOut() helper as RequireAuth, so the two can
// never disagree about who is locked out — including the expired-suspension
// case, where the user is treated as active again.
export default function SupportLayout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const lockedOut = profile ? isLockedOut(profile.account_status, profile.suspended_until) : false;

  if (!lockedOut) return <AppLayout>{children}</AppLayout>;

  return (
    <div className="min-vh-100 bg-light">
      <div className="border-bottom bg-white py-2 px-3">
        <Container style={{ maxWidth: 820 }} className="px-0 d-flex align-items-center justify-content-between">
          <span className="fw-semibold">One-Klik Support</span>
          <Link to="/dashboard" className="small">
            Back to account status
          </Link>
        </Container>
      </div>
      <Container style={{ maxWidth: 820 }} className="py-4">
        {children}
      </Container>
    </div>
  );
}
