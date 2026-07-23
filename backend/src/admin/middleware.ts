import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

// Chains after requireAuth. Re-checks profiles.is_admin against the DB on
// every request rather than trusting a JWT claim — the JWT never carries
// is_admin, and this is deliberately a second, independent gate on top of
// the is_admin() RLS policies already enforced at the Postgres level. Fails
// closed: any missing profile or query error is treated as "not admin".
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "requireAdmin: profile lookup failed");
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!data?.is_admin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
