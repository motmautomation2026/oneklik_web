import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { normalizeCompany, extractRows, type Company } from "../lib/companyNormalize.js";

const router = Router();

const MAX_COMPANY_COUNT = 100;

interface CompanySearchBody {
  industries?: string[];
  locations?: string[];
  company_size?: string[];
  company_count?: number;
}

router.post("/hv/company-search", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
  const webhookUrl = process.env["get-companies_webhook"];
  if (!webhookUrl) {
    return res.status(500).json({ error: "get-companies_webhook not configured" });
  }

  const body = (req.body ?? {}) as CompanySearchBody;
  const rawIndustries = Array.isArray(body.industries) ? body.industries : [];
  const rawLocations = Array.isArray(body.locations) ? body.locations : [];
  const companySize = Array.isArray(body.company_size) ? body.company_size : [];

  // Same rule the frontend button-disable enforces — checked again here
  // because the client can never be trusted as the only gate.
  if (rawIndustries.length === 0 && rawLocations.length === 0) {
    return res.status(400).json({ error: "At least one industry or location filter is required" });
  }

  const industries = rawIndustries;
  const locations = rawLocations.length > 0 ? rawLocations : ["India"];
  const companyCount = Math.min(Math.max(1, Number(body.company_count) || 10), MAX_COMPANY_COUNT);

  const userId = req.user!.id;
  const creditsNeeded = Math.ceil(companyCount / 25);

  const { data: run, error: runError } = await supabaseAdmin
    .from("enrichment_runs")
    .insert({
      user_id: userId,
      run_type: "company_search",
      status: "pending",
      requested_count: companyCount,
    })
    .select("id")
    .single();

  if (runError || !run) {
    req.log.error({ err: runError }, "failed to create enrichment_run");
    return res.status(500).json({ error: "Could not start company search" });
  }

  const runId = run.id as string;

  const { error: holdError } = await supabaseAdmin.rpc("fn_hold_credits", {
    p_user_id: userId,
    p_run_id: runId,
    p_amount: creditsNeeded,
  });

  if (holdError) {
    await supabaseAdmin
      .from("enrichment_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", runId);

    const insufficient = holdError.message?.includes("insufficient_credits");
    return res.status(insufficient ? 402 : 500).json({
      error: insufficient ? "Not enough credits for this search" : "Could not reserve credits",
    });
  }

  let companies: Company[] = [];
  let n8nFailed = false;

  try {
    const payload = { industries, locations, company_size: companySize, company_count: companyCount };
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!n8nRes.ok) {
      const bodyText = await n8nRes.text().catch(() => "");
      req.log.error({ status: n8nRes.status, body: bodyText }, "company-search webhook returned non-2xx");
      n8nFailed = true;
    } else {
      const bodyText = await n8nRes.text();
      // n8n sends a bare 200 with an empty body when a workflow branch
      // never reaches its Respond-to-Webhook node (e.g. "no matches
      // found") — that's a valid zero-results answer, not a failure.
      const data: unknown = bodyText.trim() ? JSON.parse(bodyText) : [];
      const rows = extractRows(data);
      companies = rows
        .map((row) => normalizeCompany(row as Record<string, unknown>))
        .filter((c) => c.Company.length > 0)
        // n8n doesn't reliably honor company_count as a hard cap — trim here
        // so a user is never billed for, or shown, more than they asked for.
        .slice(0, companyCount);
    }
  } catch (err) {
    req.log.error({ err }, "company-search webhook call failed");
    n8nFailed = true;
  }

  const { error: resolveError } = await supabaseAdmin.rpc("fn_resolve_run", {
    p_run_id: runId,
    p_outcome: n8nFailed ? "failed" : "completed",
    p_delivered_count: companies.length,
  });

  if (resolveError) {
    req.log.error({ err: resolveError }, "failed to resolve company_search run");
  }

  if (n8nFailed) {
    return res.status(502).json({ error: "Company search provider failed, credits released" });
  }

  return res.json({ companies });
});

export default router;
