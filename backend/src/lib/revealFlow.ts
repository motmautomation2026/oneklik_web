import type { Request, Response } from "express";
import { supabaseAdmin } from "./supabaseAdmin.js";

const MAX_ROWS_PER_REQUEST = 50;

export interface Person {
  "FULL NAME": string;
  "USER SOCIAL": string;
  "JOB POSITION": string;
  COUNTRY: string;
  LOCATION: string;
  INDUSTRY: string;
  "COMPANY NAME": string;
  "COMPANY URL": string;
  "COMPANY SOCIAL LINK": string;
  "COMPANY SIZE": string;
  "COMPANY COUNTRY": string;
  "COMPANY LOCATION": string;
  "COMPANY STATE": string;
  "COMPANY CITY": string;
  Email: string;
  Phone: string;
}

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Shared by People Search and LinkedIn Lookup — both receive rows from n8n
// in this same loose shape and need the same tolerant key-casing lookup.
export function normalizePerson(row: Record<string, unknown>): Person {
  const pick = (...keys: string[]) => pickFirstNonEmpty(...keys.map((key) => row[key]));
  return {
    "FULL NAME": pick("FULL NAME", "Full Name", "full_name", "FullName", "Name", "name"),
    "USER SOCIAL": pick("USER SOCIAL", "User Social", "LinkedIn", "LINKEDIN", "linkedin"),
    "JOB POSITION": pick("JOB POSITION", "Job Position", "Job Title", "JOB TITLE", "title"),
    COUNTRY: pick("COUNTRY", "Country", "country"),
    LOCATION: pick("LOCATION", "Location", "location"),
    INDUSTRY: pick("INDUSTRY", "Industry", "industry"),
    "COMPANY NAME": pick("COMPANY NAME", "Company Name", "Company", "company"),
    "COMPANY URL": pick("COMPANY URL", "Company URL", "Website", "WEBSITE", "Domain", "domain"),
    "COMPANY SOCIAL LINK": pick("COMPANY SOCIAL LINK", "Company Social Link", "Company LinkedIn"),
    "COMPANY SIZE": pick("COMPANY SIZE", "Company Size", "Headcount", "HEADCOUNT"),
    "COMPANY COUNTRY": pick("COMPANY COUNTRY", "Company Country"),
    "COMPANY LOCATION": pick("COMPANY LOCATION", "Company Location"),
    "COMPANY STATE": pick("COMPANY STATE", "Company State"),
    "COMPANY CITY": pick("COMPANY CITY", "Company City"),
    Email: pick("Email", "EMAIL", "email"),
    Phone: pick("Phone", "PHONE", "phone"),
  };
}

export interface RevealConfig {
  webhookEnvVar: string;
  creditsPerReveal: number;
  runType: "email_enrich" | "mobile_enrich";
  targetField: "Email" | "Phone";
  listNamePrefix: string;
  providerName: string;
  notConfiguredError: string;
}

// Shared by email and phone reveal — both are: hold credits worst-case,
// send the whole selected batch to n8n in one call (per-row calls kept
// hitting the n8n test-webhook "answers once per arm" limit), then resolve
// each row's hold individually based on whether its target field came back
// filled in the response. Only the field name, credit amount, run_type, and
// webhook differ between the two callers.
export async function runRevealBatch(req: Request, res: Response, config: RevealConfig) {
  const webhookUrl = process.env[config.webhookEnvVar];
  if (!webhookUrl) {
    return res.status(500).json({ error: config.notConfiguredError });
  }

  const body = (req.body ?? {}) as { people?: Person[] };
  const people = Array.isArray(body.people) ? body.people.slice(0, MAX_ROWS_PER_REQUEST) : [];

  if (people.length === 0) {
    return res.status(400).json({ error: "Select at least one person to reveal" });
  }

  const userId = req.user!.id;

  // Pre-check affordability and truncate to what's actually affordable,
  // rather than holding the whole selected batch's worst-case in one shot.
  // Otherwise "2 credits available, 2 rows selected at 2cr each" holds for
  // 4, fails outright, and reveals nothing — even though one of those two
  // might genuinely have been affordable on its own.
  const { data: wallet } = await supabaseAdmin
    .from("credit_wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();
  const availableBalance = wallet?.available_balance ?? 0;
  const maxAffordable = Math.min(people.length, Math.floor(availableBalance / config.creditsPerReveal));

  if (maxAffordable === 0) {
    return res.status(402).json({
      error: `Not enough credits — need at least ${config.creditsPerReveal} to reveal even one.`,
      people,
      skipped_count: people.length,
    });
  }

  const skippedCount = people.length - maxAffordable;
  const peopleToProcess = people.slice(0, maxAffordable);
  const peopleSkipped = people.slice(maxAffordable);

  const { data: list, error: listError } = await supabaseAdmin
    .from("lists")
    .insert({
      user_id: userId,
      name: `${config.listNamePrefix} — ${new Date().toISOString().slice(0, 10)}`,
      kind: "people",
    })
    .select("id")
    .single();

  if (listError || !list) {
    req.log.error({ err: listError }, `failed to create ${config.providerName} reveal list`);
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const { data: listItems, error: itemsError } = await supabaseAdmin
    .from("list_items")
    .insert(peopleToProcess.map((p) => ({ list_id: list.id, user_id: userId, data: p })))
    .select("id");

  if (itemsError || !listItems || listItems.length !== peopleToProcess.length) {
    req.log.error({ err: itemsError }, "failed to create list_items for reveal");
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from("enrichment_runs")
    .insert({
      user_id: userId,
      list_id: list.id,
      run_type: config.runType,
      status: "pending",
      requested_count: peopleToProcess.length,
    })
    .select("id")
    .single();

  if (runError || !run) {
    req.log.error({ err: runError }, "failed to create enrichment_run");
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const runId = run.id as string;
  const creditsNeeded = peopleToProcess.length * config.creditsPerReveal;

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
      error: insufficient ? "Not enough credits for this reveal" : "Could not reserve credits",
    });
  }

  let responseRows: Record<string, unknown>[] = [];
  let batchFailed = false;

  try {
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ people: peopleToProcess }),
    });

    if (n8nRes.ok) {
      const data: unknown = await n8nRes.json();
      const rows: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.people)
          ? ((data as Record<string, unknown>).people as unknown[])
          : Array.isArray((data as Record<string, unknown>)?.data)
            ? ((data as Record<string, unknown>).data as unknown[])
            : [];
      responseRows = rows as Record<string, unknown>[];
    } else {
      const bodyText = await n8nRes.text().catch(() => "");
      req.log.error(
        { status: n8nRes.status, body: bodyText.slice(0, 300) },
        `${config.providerName} webhook returned non-2xx`,
      );
      batchFailed = true;
    }
  } catch (err) {
    req.log.error({ err }, `${config.providerName} webhook call failed`);
    batchFailed = true;
  }

  const results: Person[] = [];
  // Real responses have shown fields echoed back under lowercase or
  // uppercase variants of the canonical key — check all three.
  const fieldCandidates =
    config.targetField === "Email" ? ["Email", "email", "EMAIL"] : ["Phone", "phone", "PHONE"];

  for (let i = 0; i < peopleToProcess.length; i++) {
    const person = peopleToProcess[i];
    const listItemId = listItems[i].id as string;
    const row = responseRows[i];

    const value = batchFailed ? "" : pickFirstNonEmpty(...fieldCandidates.map((key) => row?.[key]));
    const outcome: "found" | "not_found" | "error" = batchFailed ? "error" : value ? "found" : "not_found";
    const updatedPerson: Person = { ...person, [config.targetField]: value };

    await supabaseAdmin.from("enrichment_results").insert({
      run_id: runId,
      list_item_id: listItemId,
      user_id: userId,
      provider: config.providerName,
      outcome,
      cost: 0,
    });

    await supabaseAdmin
      .from("list_items")
      .update({
        data: updatedPerson,
        enrichment_status: outcome === "found" ? "enriched" : outcome === "not_found" ? "not_found" : "error",
      })
      .eq("id", listItemId);

    const { error: resolveError } = await supabaseAdmin.rpc("fn_resolve_row", {
      p_run_id: runId,
      p_list_item_id: listItemId,
      p_outcome: outcome,
      p_credits: config.creditsPerReveal,
    });

    if (resolveError) {
      req.log.error({ err: resolveError }, "failed to resolve reveal row");
    }

    results.push(updatedPerson);
  }

  if (batchFailed) {
    return res.status(502).json({ error: `${config.providerName} provider failed, credits released` });
  }

  // Skipped rows were never sent to the webhook or charged — merge them
  // back in unrevealed, in their original order, so the caller gets a
  // result for every row it selected, not just the affordable subset.
  const finalResults = [...results, ...peopleSkipped];

  return res.json({ people: finalResults, list_id: list.id, skipped_count: skippedCount });
}
