// Shared account-moderation primitives, kept out of AuthProvider.tsx so that
// file exports only its component/hook (React Fast Refresh requirement) and so
// lib/api.ts can reference the event name without importing the provider.

export type AccountStatus = "active" | "frozen" | "suspended" | "banned";

// Dispatched by lib/api.ts whenever the backend returns a structured
// account-status 403 — AuthProvider listens and re-reads the profile so a
// mid-session freeze/suspend/ban flips the UI without a reload.
export const ACCOUNT_STATUS_EVENT = "oneklik:account-status";

// True when a time-boxed suspension has passed its deadline. Mirrors the
// backend's lazy-expiry check (enforceAccountStatus) so the UI stops locking
// the user out the moment the suspension expires — the DB row still reads
// 'suspended' until their next product API call heals it, and gating on this
// avoids a deadlock where the lockout screen blocks the very request that
// would flip the status back to active.
export function isSuspensionExpired(suspendedUntil: string | null): boolean {
  return suspendedUntil !== null && new Date(suspendedUntil).getTime() <= Date.now();
}

// Whether a profile's status should lock the user out of the app entirely.
// 'frozen' is not a lockout (read access is retained); an expired suspension
// is not a lockout (see above).
export function isLockedOut(status: AccountStatus, suspendedUntil: string | null): boolean {
  if (status === "banned") return true;
  if (status === "suspended") return !isSuspensionExpired(suspendedUntil);
  return false;
}
