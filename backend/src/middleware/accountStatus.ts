import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

export type AccountStatus = "active" | "frozen" | "suspended" | "banned";

interface EnforceOptions {
  // When true, 'frozen' accounts pass through — for non-spend / read-only
  // routes (payment status polling, filter suggestions). 'suspended' and
  // 'banned' are always blocked. Defaults to false: frozen is blocked too,
  // which is what every credit-spending or data-mutating route wants.
  allowFrozen?: boolean;
}

const RESTRICTED_MESSAGE: Record<Exclude<AccountStatus, "active">, string> = {
  frozen: "Your account is frozen — you can view your data, but can't use credits right now. Contact support if you think this is a mistake.",
  suspended: "Your account is suspended. Contact support if you think this is a mistake.",
  banned: "Your account has been banned.",
};

// Chains after requireAuth on every product route. A banned user whose
// sessions were revoked is already rejected upstream (requireAuth's getUser
// no longer resolves their token), so this is primarily the app-layer gate
// for 'frozen' and 'suspended', plus a belt-and-suspenders check for 'banned'
// during the brief window before revocation propagates.
//
// The status is read live from profiles on every request — deliberately not
// cached in the JWT — so an admin's freeze/suspend/ban takes effect on the
// user's very next call, with no stale-token grace period.
export function enforceAccountStatus(options: EnforceOptions = {}) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const userId = req.user?.id;
    if (!userId) {
      // requireAuth is expected to have run first and populated req.user;
      // if it somehow didn't, fail closed rather than waving the request on.
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("account_status, suspended_until")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      req.log.error({ err: error }, "enforceAccountStatus: profile lookup failed");
      return res.status(503).json({ error: "Could not verify account status" });
    }

    let status = (data?.account_status ?? "active") as AccountStatus;
    let suspendedUntil = data?.suspended_until ?? null;

    // Lazy expiry: a time-boxed suspension whose deadline has passed lifts
    // automatically on the next request, so no scheduled job is needed. The
    // DB flip is a conditional update — WHERE account_status='suspended' — so
    // it can never clobber a status an admin changed in the same window (it
    // just matches nothing), and .select() tells us whether *this* request
    // was the one that performed the flip. Only that request writes the audit
    // row (so concurrent expired requests don't duplicate it) and may treat
    // itself as active. If the update matched nothing, something else changed
    // the status concurrently — re-read the authoritative value rather than
    // assuming 'active', which would otherwise let a request slip past a ban
    // that landed in the race window.
    if (status === "suspended" && suspendedUntil && new Date(suspendedUntil).getTime() <= Date.now()) {
      const { data: flipped, error: reactivateError } = await supabaseAdmin
        .from("profiles")
        .update({
          account_status: "active",
          suspended_until: null,
          status_reason: null,
          status_updated_at: new Date().toISOString(),
          status_updated_by: null,
        })
        .eq("id", userId)
        .eq("account_status", "suspended")
        .select("id");

      if (reactivateError) {
        // Couldn't perform the lift — stay closed and keep enforcing the
        // suspension rather than guessing; it self-heals on the next request.
        req.log.error({ err: reactivateError }, "enforceAccountStatus: auto-reactivate failed");
      } else if (flipped && flipped.length > 0) {
        await supabaseAdmin.from("moderation_actions").insert({
          user_id: userId,
          action: "reactivate",
          previous_status: "suspended",
          new_status: "active",
          reason: "suspension expired",
          acted_by: null,
        });
        status = "active";
        suspendedUntil = null;
      } else {
        const { data: fresh } = await supabaseAdmin
          .from("profiles")
          .select("account_status, suspended_until")
          .eq("id", userId)
          .maybeSingle();
        status = (fresh?.account_status ?? "active") as AccountStatus;
        suspendedUntil = fresh?.suspended_until ?? null;
      }
    }

    if (status === "active") return next();
    if (status === "frozen" && options.allowFrozen) return next();

    return res.status(403).json({
      error: RESTRICTED_MESSAGE[status as Exclude<AccountStatus, "active">],
      account_status: status,
      suspended_until: suspendedUntil,
    });
  };
}
