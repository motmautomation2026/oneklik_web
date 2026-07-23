import { Link, useNavigate } from "react-router-dom";
import { List } from "react-bootstrap-icons";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthProvider";

interface AdminTopbarProps {
  onOpenMobileNav: () => void;
}

// Replaces AppLayout's credits-balance topbar, which has no meaning in the
// admin console — an admin's own credit balance isn't the point here.
export default function AdminTopbar({ onOpenMobileNav }: AdminTopbarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div className="app-topbar d-flex align-items-center justify-content-between gap-3 px-3 py-2 border-bottom bg-white">
      <button
        type="button"
        className="btn btn-outline-primary btn-sm d-md-none"
        onClick={onOpenMobileNav}
        aria-label="Open menu"
      >
        <List size={18} />
      </button>
      <div className="d-flex align-items-center gap-3 ms-auto">
        {user?.email && <span className="small text-body-secondary">{user.email}</span>}
        <Link to="/dashboard" className="btn btn-outline-secondary btn-sm">
          Exit to app
        </Link>
        <button className="btn btn-outline-primary btn-sm" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
