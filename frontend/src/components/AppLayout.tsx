import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Dropdown, Spinner } from "react-bootstrap";
import { ChevronDown, List, Wallet2 } from "react-bootstrap-icons";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import Sidebar from "./Sidebar";

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0];
  return local.slice(0, 2).toUpperCase();
}

interface Wallet {
  available_balance: number;
  held_balance: number;
}

const LOW_BALANCE_THRESHOLD = 10;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("credit_wallets")
      .select("available_balance, held_balance")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setWallet(data);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  const lowBalance = wallet !== null && wallet.available_balance < LOW_BALANCE_THRESHOLD;

  return (
    <div className="d-flex min-vh-100 bg-white">
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-grow-1 d-flex flex-column" style={{ minWidth: 0 }}>
        <div className="app-topbar d-flex align-items-center justify-content-between gap-3 px-3 py-2 border-bottom bg-white">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm d-md-none"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <List size={18} />
          </button>
          <div className="d-flex align-items-center gap-2 ms-auto">
            {lowBalance && (
              <Badge bg="warning" text="dark">
                Low balance
              </Badge>
            )}
            <div className="app-topbar-credits">
              <span>Available Credits</span>
              {wallet ? <strong>{wallet.available_balance}</strong> : <Spinner animation="border" size="sm" />}
            </div>

            <span className="app-topbar-divider" />

            <button
              type="button"
              className="app-topbar-icon-btn"
              onClick={() => navigate("/wallet")}
              aria-label="Wallet"
              title="Wallet"
            >
              <Wallet2 size={18} />
            </button>

            <Dropdown align="end">
              <Dropdown.Toggle as="button" className="app-user-menu-toggle" id="user-menu-toggle">
                <span className="app-avatar">{initialsFromEmail(user?.email)}</span>
                <ChevronDown size={12} className="text-body-secondary" />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => navigate("/profile")}>Profile</Dropdown.Item>
                <Dropdown.Item onClick={() => navigate("/wallet")}>Wallet</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item onClick={handleSignOut}>Sign out</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>
        <div className="flex-grow-1 bg-light">{children}</div>
      </div>
    </div>
  );
}
