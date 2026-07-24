import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { normalizeCompany, extractRows, type Company } from "../lib/companyNormalize.js";

const router = Router();

// No user-chosen count in AI mode — one sentence in, results capped here.
// ceil(25/25) = 1 credit held, same tiered formula as manual search, just
// pinned to a fixed ceiling instead of a user-provided company_count.
const AI_SEARCH_CAP = 25;

router.post("/hv/company-search-ai", requireAuth, async (req: Request, res: Response) => {
  const webhookUrl = process.env["company_search_ai_webhook"];
  if (!webhookUrl) {
    return res.status(500).json({ error: "company_search_ai_webhook not configured" });
  }

  const body = (req.body ?? {}) as { sentence?: string };
  const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";

  if (!sentence) {
    return res.status(400).json({ error: "Describe what you're looking for" });
  }

  const userId = req.user!.id;
  const creditsNeeded = Math.ceil(AI_SEARCH_CAP / 25);

  const { data: run, error: runError } = await supabaseAdmin
    .from("enrichment_runs")
    .insert({
      user_id: userId,
      run_type: "company_search",
      status: "pending",
      requested_count: AI_SEARCH_CAP,
    })
    .select("id")
    .single();

  if (runError || !run) {
    req.log.error({ err: runError }, "failed to create enrichment_run for AI company search");
    return res.status(500).json({ error: "Could not start AI search" });
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
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence }),
    });

    if (!n8nRes.ok) {
      const bodyText = await n8nRes.text().catch(() => "");
      req.log.error({ status: n8nRes.status, body: bodyText }, "company-search-ai webhook returned non-2xx");
      n8nFailed = true;
    } else {
      const bodyText = await n8nRes.text();
      // n8n sends a bare 200 with an empty body when a workflow branch
      // never reaches its Respond-to-Webhook node (e.g. "no matches
      // found") — that's a valid zero-results answer, not a failure.
      const data: unknown = bodyText.trim() ? JSON.parse(bodyText) : [];
      companies = extractRows(data)
        .map((row) => normalizeCompany(row as Record<string, unknown>))
        .filter((c) => c.Company.length > 0)
        .slice(0, AI_SEARCH_CAP);
    }
  } catch (err) {
    req.log.error({ err }, "company-search-ai webhook call failed");
    n8nFailed = true;
  }

  const { error: resolveError } = await supabaseAdmin.rpc("fn_resolve_run", {
    p_run_id: runId,
    p_outcome: n8nFailed ? "failed" : "completed",
    p_delivered_count: companies.length,
  });

  if (resolveError) {
    req.log.error({ err: resolveError }, "failed to resolve AI company_search run");
  }

  if (n8nFailed) {
    return res.status(502).json({ error: "AI search provider failed, credits released" });
  }

  return res.json({ companies });
});

export default router;
