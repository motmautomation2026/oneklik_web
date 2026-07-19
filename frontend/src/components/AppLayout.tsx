import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Spinner } from "react-bootstrap";
import { List } from "react-bootstrap-icons";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import Sidebar from "./Sidebar";

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
          <div className="d-flex align-items-center gap-3 ms-auto">
            {lowBalance && (
              <Badge bg="warning" text="dark">
                Low balance
              </Badge>
            )}
            <span className="small">
              Credits:{" "}
              {wallet ? <strong>{wallet.available_balance}</strong> : <Spinner animation="border" size="sm" />}
            </span>
            <button className="btn btn-outline-primary btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
        <div className="flex-grow-1 bg-light">{children}</div>
      </div>
    </div>
  );
}
