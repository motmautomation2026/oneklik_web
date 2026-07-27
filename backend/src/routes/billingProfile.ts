import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { gstinIsValid } from "../lib/gst.js";
import { GST_STATES, stateCodeFromGstin, stateNameFromCode } from "../lib/gstStates.js";

const router = Router();

export interface BillingProfileBody {
  legal_name?: string;
  entity_type?: "business" | "individual";
  gstin?: string | null;
  address_line1?: string;
  address_line2?: string | null;
  city?: string;
  state_code?: string;
  state_name?: string;
  postal_code?: string;
  country?: string;
}

function isComplete(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(
    typeof row.legal_name === "string" &&
      row.legal_name.trim() &&
      (row.entity_type === "business" || row.entity_type === "individual") &&
      typeof row.address_line1 === "string" &&
      row.address_line1.trim() &&
      typeof row.city === "string" &&
      row.city.trim() &&
      typeof row.state_code === "string" &&
      /^[0-9]{2}$/.test(row.state_code) &&
      typeof row.state_name === "string" &&
      row.state_name.trim() &&
      typeof row.postal_code === "string" &&
      row.postal_code.trim(),
  );
}

router.get("/billing/states", requireAuth, enforceAccountStatus({ allowFrozen: true }), (_req: Request, res: Response) => {
  return res.json({ states: GST_STATES });
});

router.get("/billing/profile", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin.from("billing_profiles").select("*").eq("user_id", userId).maybeSingle();

  if (error) {
    req.log.error({ err: error }, "failed to load billing profile");
    return res.status(500).json({ error: "Could not load billing profile" });
  }

  return res.json({
    profile: data,
    complete: isComplete(data as Record<string, unknown> | null),
  });
});

router.put("/billing/profile", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as BillingProfileBody;

  const legal_name = typeof body.legal_name === "string" ? body.legal_name.trim() : "";
  const entity_type = body.entity_type === "business" || body.entity_type === "individual" ? body.entity_type : null;
  const address_line1 = typeof body.address_line1 === "string" ? body.address_line1.trim() : "";
  const address_line2 =
    typeof body.address_line2 === "string" && body.address_line2.trim() ? body.address_line2.trim() : null;
  const city = typeof body.city === "string" ? body.city.trim() : "";
  let state_code = typeof body.state_code === "string" ? body.state_code.trim() : "";
  let state_name = typeof body.state_name === "string" ? body.state_name.trim() : "";
  const postal_code = typeof body.postal_code === "string" ? body.postal_code.trim() : "";
  const country = body.country === "IN" || !body.country ? "IN" : null;

  let gstin: string | null = null;
  if (typeof body.gstin === "string" && body.gstin.trim()) {
    gstin = body.gstin.trim().toUpperCase();
    if (!gstinIsValid(gstin)) {
      return res.status(400).json({ error: "Invalid GSTIN format" });
    }
    const fromGstin = stateCodeFromGstin(gstin);
    if (fromGstin) {
      if (state_code && state_code !== fromGstin) {
        return res.status(400).json({ error: "GSTIN state code does not match the selected state" });
      }
      state_code = fromGstin;
      state_name = stateNameFromCode(fromGstin) ?? state_name;
    }
  }

  if (!legal_name || !entity_type || !address_line1 || !city || !state_code || !state_name || !postal_code || !country) {
    return res.status(400).json({ error: "Missing required billing fields" });
  }

  if (!/^[0-9]{2}$/.test(state_code) || !stateNameFromCode(state_code)) {
    return res.status(400).json({ error: "Invalid state" });
  }

  if (stateNameFromCode(state_code) && state_name !== stateNameFromCode(state_code)) {
    state_name = stateNameFromCode(state_code)!;
  }

  const row = {
    user_id: userId,
    legal_name,
    entity_type,
    gstin,
    address_line1,
    address_line2,
    city,
    state_code,
    state_name,
    postal_code,
    country,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin.from("billing_profiles").upsert(row, { onConflict: "user_id" }).select("*").single();

  if (error || !data) {
    req.log.error({ err: error }, "failed to save billing profile");
    return res.status(500).json({ error: "Could not save billing profile" });
  }

  return res.json({ profile: data, complete: true });
});

export default router;
