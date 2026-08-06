import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { normalizePerson, type Person } from "../lib/revealFlow.js";
import { ensureSubscriptionCreditState } from "../lib/ensureSubscription.js";

const router = Router();

const MAX_COUNT_PER_COMPANY = 50;
const MAX_TOTAL_PEOPLE = 200;

interface PeopleSearchBody {
  domains?: string[];
  job_titles?: string[];
  locations?: string[];
  count_per_company?: number;
}

// n8n sometimes answers with a validation complaint instead of person rows —
// e.g. [{"message": "Subdomains are not supported: parry.murugappa.com"}].
// Fed through normalizePerson this yields an empty FULL NAME and gets
// silently filtered out, leaving the user with a bare "no results" and no
// idea their input (not the search) was the problem. Detected up front so
// the actual correction hint reaches the user instead of being discarded.
function extractProviderMessage(rows: unknown[]): string | null {
  const messages = rows
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).message : undefined))
    .filter((m): m is string => typeof m === "string" && m.trim().length > 0);
  return messages.length > 0 ? messages.join("; ") : null;
}

router.post("/hv/people-search", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
  const webhookUrl = process.env["get-people_webhook"];
  if (!webhookUrl) {
    return res.status(500).json({ error: "get-people_webhook not configured" });
  }

  const body = (req.body ?? {}) as PeopleSearchBody;
  const domains = Array.isArray(body.domains) ? body.domains.filter(Boolean) : [];
  const jobTitles = Array.isArray(body.job_titles) ? body.job_titles.filter(Boolean) : [];
  const locations = Array.isArray(body.locations) ? body.locations.filter(Boolean) : [];

  if (domains.length === 0) {
    return res.status(400).json({ error: "At least one company domain is required" });
  }

  const countPerCompany = Math.min(Math.max(1, Number(body.count_per_company) || 10), MAX_COUNT_PER_COMPANY);
  const maxTotal = Math.min(domains.length * countPerCompany, MAX_TOTAL_PEOPLE);

  const userId = req.user!.id;
  await ensureSubscriptionCreditState(userId, req.log);
  const creditsNeeded = Math.ceil(maxTotal / 25);

  const { data: run, error: runError } = await supabaseAdmin
    .from("enrichment_runs")
    .insert({
      user_id: userId,
      run_type: "people_search",
      status: "pending",
      requested_count: maxTotal,
    })
    .select("id")
    .single();

  if (runError || !run) {
    req.log.error({ err: runError }, "failed to create enrichment_run");
    return res.status(500).json({ error: "Could not start people search" });
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

  let people: Person[] = [];
  let n8nFailed = false;
  let providerMessage: string | null = null;

  try {
    const payload = { domains, job_titles: jobTitles, locations, count_per_company: countPerCompany };
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!n8nRes.ok) {
      const bodyText = await n8nRes.text().catch(() => "");
      req.log.error({ status: n8nRes.status, body: bodyText }, "people-search webhook returned non-2xx");
      n8nFailed = true;
    } else {
      const bodyText = await n8nRes.text();
      // n8n sends a bare 200 with an empty body when a workflow branch
      // never reaches its Respond-to-Webhook node (e.g. "no matches
      // found") — that's a valid zero-results answer, not a failure.
      const data: unknown = bodyText.trim() ? JSON.parse(bodyText) : [];
      const rows: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.people)
          ? ((data as Record<string, unknown>).people as unknown[])
          : Array.isArray((data as Record<string, unknown>)?.data)
            ? ((data as Record<string, unknown>).data as unknown[])
            : [];
      providerMessage = extractProviderMessage(rows);
      people = rows
        .map((row) => normalizePerson(row as Record<string, unknown>))
        .filter((p) => p["FULL NAME"].length > 0)
        .slice(0, maxTotal);
    }
  } catch (err) {
    req.log.error({ err }, "people-search webhook call failed");
    n8nFailed = true;
  }

  const { error: resolveError } = await supabaseAdmin.rpc("fn_resolve_run", {
    p_run_id: runId,
    p_outcome: n8nFailed ? "failed" : "completed",
    p_delivered_count: people.length,
  });

  if (resolveError) {
    req.log.error({ err: resolveError }, "failed to resolve people_search run");
  }

  if (n8nFailed) {
    return res.status(502).json({ error: "People search provider failed, credits released" });
  }

  // Not billed (delivered_count is 0), but this is a correction the user can
  // actually act on — surface it instead of a bare "no results".
  if (providerMessage && people.length === 0) {
    return res.status(400).json({ error: providerMessage });
  }

  return res.json({ people });
});

export default router;
