import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Dropdown, Popover, ProgressBar, Spinner } from "react-bootstrap";
import { ChevronDown, Headset, List, Wallet2 } from "react-bootstrap-icons";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import { fetchUnreadCount } from "../lib/supportApi";
import Sidebar from "./Sidebar";

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0];
  return local.slice(0, 2).toUpperCase();
}

interface Wallet {
  available_balance: number;
  held_balance: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
}

const LOW_BALANCE_THRESHOLD = 10;

// Same reasoning as the admin sidebar badge: a support reply the user hasn't
// seen only has to be roughly current, and polling one integer is cheaper than
// holding open a realtime subscription for it.
const SUPPORT_POLL_MS = 60_000;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const supportCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("credit_wallets")
      .select("available_balance, held_balance, lifetime_purchased, lifetime_consumed")
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

  // Hover-to-open: opens instantly, but closes on a short delay so moving
  // the cursor across the small gap between the toggle and the menu (or a
  // brief flick outside) doesn't snap it shut. Click/keyboard/Escape/outside
  // click still work as normal — onToggle mirrors Bootstrap's own decision
  // for those, this only adds the two hover-driven paths on top.
  function openUserMenu() {
    if (userMenuCloseTimer.current) {
      clearTimeout(userMenuCloseTimer.current);
      userMenuCloseTimer.current = null;
    }
    setUserMenuOpen(true);
  }

  function scheduleCloseUserMenu() {
    userMenuCloseTimer.current = setTimeout(() => setUserMenuOpen(false), 200);
  }

  // Same idea for the wallet popover: stays open while the cursor is over
  // the icon or the card itself, and only closes once it has left both
  // (the short delay just covers the gap while crossing from one to the other).
  function openWallet() {
    if (walletCloseTimer.current) {
      clearTimeout(walletCloseTimer.current);
      walletCloseTimer.current = null;
    }
    setWalletOpen(true);
  }

  function scheduleCloseWallet() {
    walletCloseTimer.current = setTimeout(() => setWalletOpen(false), 150);
  }

  function openSupport() {
    if (supportCloseTimer.current) {
      clearTimeout(supportCloseTimer.current);
      supportCloseTimer.current = null;
    }
    setSupportOpen(true);
  }

  function scheduleCloseSupport() {
    supportCloseTimer.current = setTimeout(() => setSupportOpen(false), 150);
  }

  useEffect(() => {
    return () => {
      if (userMenuCloseTimer.current) clearTimeout(userMenuCloseTimer.current);
      if (walletCloseTimer.current) clearTimeout(walletCloseTimer.current);
      if (supportCloseTimer.current) clearTimeout(supportCloseTimer.current);
    };
  }, []);

  // Unread support replies. Failures are swallowed on purpose — a support
  // badge is not worth an error banner over the whole app, and the count just
  // keeps its last value.
  useEffect(() => {
    if (!user) return;
    let active = true;
    const controller = new AbortController();

    const load = () => {
      fetchUnreadCount(controller.signal)
        .then((res) => {
          if (active) setSupportUnread(res.unread);
        })
        .catch(() => undefined);
    };

    load();
    const timer = setInterval(load, SUPPORT_POLL_MS);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [user]);

  const lowBalance = wallet !== null && wallet.available_balance < LOW_BALANCE_THRESHOLD;

  const totalEverGranted = wallet
    ? wallet.available_balance + wallet.held_balance + wallet.lifetime_consumed
    : 0;
  const consumedPct = wallet && totalEverGranted > 0 ? Math.round((wallet.lifetime_consumed / totalEverGranted) * 100) : 0;

  const walletPopover = (
    <Popover
      id="wallet-popover"
      className="app-wallet-popover"
      onMouseEnter={openWallet}
      onMouseLeave={scheduleCloseWallet}
    >
      <Popover.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="text-body-secondary small">Available credits</span>
          {wallet ? <strong className="h5 mb-0">{wallet.available_balance}</strong> : <Spinner animation="border" size="sm" />}
        </div>
        {wallet && (
          <>
            <ProgressBar now={consumedPct} className="mb-1" style={{ height: 6 }} />
            <div className="d-flex justify-content-between small text-body-secondary">
              <span>{wallet.lifetime_consumed} used</span>
              <span>{totalEverGranted} total</span>
            </div>
          </>
        )}
        <button type="button" className="btn btn-primary btn-sm w-100 mt-2" onClick={() => navigate("/wallet")}>
          View wallet
        </button>
      </Popover.Body>
    </Popover>
  );

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
            <div className="app-topbar-toolbar">
              <div className="app-wallet-anchor">
                <button
                  type="button"
                  className="app-topbar-icon-btn"
                  onClick={() => navigate("/wallet")}
                  onMouseEnter={openWallet}
                  onMouseLeave={scheduleCloseWallet}
                  onFocus={openWallet}
                  onBlur={scheduleCloseWallet}
                  aria-label="Wallet"
                  title="Wallet"
                >
                  <Wallet2 size={18} />
                </button>
                {walletOpen && walletPopover}
              </div>

              <span className="app-topbar-divider" />

              {/* Third topbar icon, alongside wallet and profile. Reuses the
                  wallet's hover-popover pattern so the three behave
                  identically. */}
              <div className="app-wallet-anchor">
                <button
                  type="button"
                  className="app-topbar-icon-btn position-relative"
                  onClick={() => navigate("/support")}
                  onMouseEnter={openSupport}
                  onMouseLeave={scheduleCloseSupport}
                  onFocus={openSupport}
                  onBlur={scheduleCloseSupport}
                  aria-label={
                    supportUnread > 0
                      ? `Support — ${supportUnread} new ${supportUnread === 1 ? "reply" : "replies"}`
                      : "Support"
                  }
                  title="Support"
                >
                  <Headset size={18} />
                  {supportUnread > 0 && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: "#dc3545",
                      }}
                    />
                  )}
                </button>
                {supportOpen && (
                  <Popover
                    id="support-popover"
                    className="app-wallet-popover"
                    onMouseEnter={openSupport}
                    onMouseLeave={scheduleCloseSupport}
                  >
                    <Popover.Body>
                      <div className="small mb-2">
                        {supportUnread > 0 ? (
                          <span className="fw-semibold">
                            {supportUnread} request{supportUnread === 1 ? " has" : "s have"} a new reply
                          </span>
                        ) : (
                          <span className="text-body-secondary">Need a hand? We'll reply in the app.</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm w-100 mb-2"
                        onClick={() => navigate("/support/new")}
                      >
                        Raise a request
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm w-100"
                        onClick={() => navigate("/support")}
                      >
                        My requests
                      </button>
                    </Popover.Body>
                  </Popover>
                )}
              </div>

              <span className="app-topbar-divider" />

              <Dropdown
                align="end"
                show={userMenuOpen}
                onToggle={(nextShow) => setUserMenuOpen(nextShow)}
                onMouseEnter={openUserMenu}
                onMouseLeave={scheduleCloseUserMenu}
              >
                <Dropdown.Toggle as="button" className="app-user-menu-toggle" id="user-menu-toggle">
                  <span className="app-avatar">{initialsFromEmail(user?.email)}</span>
                  <ChevronDown size={12} className="text-body-secondary" />
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => navigate("/profile")}>Profile</Dropdown.Item>
                  <Dropdown.Item onClick={() => navigate("/billing")}>Billing</Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={handleSignOut}>Sign out</Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </div>
        </div>
        {profile?.account_status === "frozen" && (
          <Alert variant="warning" className="mb-0 rounded-0 border-0 border-bottom py-2 px-3 small">
            <span className="fw-semibold">Your account is frozen.</span> You can view your existing data, but spending
            credits — searches, reveals, and purchases — is paused.
            {profile.status_reason ? ` Reason: ${profile.status_reason}.` : ""}{" "}
            <button
              type="button"
              className="btn btn-link btn-sm p-0 align-baseline"
              onClick={() => navigate("/support/new")}
            >
              Raise a request
            </button>{" "}
            if you think this is a mistake.
          </Alert>
        )}
        <div className="flex-grow-1 bg-light">{children}</div>
      </div>
    </div>
  );
}
