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

function extractPersonRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj?.people)) return obj.people as Record<string, unknown>[];
  if (Array.isArray(obj?.data)) return obj.data as Record<string, unknown>[];
  return [];
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

interface ListItemRef {
  id: string;
  person: Person;
}

interface CoreResult {
  batchFailed: boolean;
  resolved: ListItemRef[];
  affordableCount: number;
  creditSkippedCount: number;
}

// The actual money logic, shared by every reveal entry point (fresh
// selection -> new list, or re-run on rows already in a saved list):
// pre-check affordability and only hold for what's actually affordable
// (never "hold worst-case for the whole batch, fail outright if it doesn't
// all fit"), call the provider once for the affordable subset, then resolve
// each row against its real found/not-found outcome.
async function holdCallResolve(
  req: Request,
  userId: string,
  listId: string,
  items: ListItemRef[],
  config: RevealConfig,
): Promise<CoreResult> {
  const { data: wallet } = await supabaseAdmin
    .from("credit_wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();
  const availableBalance = wallet?.available_balance ?? 0;
  const maxAffordable = Math.min(items.length, Math.floor(availableBalance / config.creditsPerReveal));

  if (maxAffordable === 0) {
    return { batchFailed: false, resolved: [], affordableCount: 0, creditSkippedCount: items.length };
  }

  const toProcess = items.slice(0, maxAffordable);
  const creditSkippedCount = items.length - maxAffordable;

  const { data: run, error: runError } = await supabaseAdmin
    .from("enrichment_runs")
    .insert({
      user_id: userId,
      list_id: listId,
      run_type: config.runType,
      status: "pending",
      requested_count: toProcess.length,
    })
    .select("id")
    .single();

  if (runError || !run) {
    req.log.error({ err: runError }, "failed to create enrichment_run");
    return { batchFailed: true, resolved: [], affordableCount: 0, creditSkippedCount: items.length };
  }

  const runId = run.id as string;

  const { error: holdError } = await supabaseAdmin.rpc("fn_hold_credits", {
    p_user_id: userId,
    p_run_id: runId,
    p_amount: toProcess.length * config.creditsPerReveal,
  });

  if (holdError) {
    await supabaseAdmin
      .from("enrichment_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", runId);
    return { batchFailed: true, resolved: [], affordableCount: 0, creditSkippedCount: items.length };
  }

  const webhookUrl = process.env[config.webhookEnvVar] as string;
  let responseRows: Record<string, unknown>[] = [];
  let batchFailed = false;

  try {
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ people: toProcess.map((i) => i.person) }),
    });

    if (n8nRes.ok) {
      const data: unknown = await n8nRes.json();
      responseRows = extractPersonRows(data);
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

  const fieldCandidates =
    config.targetField === "Email" ? ["Email", "email", "EMAIL"] : ["Phone", "phone", "PHONE"];
  const resolved: ListItemRef[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const row = responseRows[i];

    const value = batchFailed ? "" : pickFirstNonEmpty(...fieldCandidates.map((key) => row?.[key]));
    const outcome: "found" | "not_found" | "error" = batchFailed ? "error" : value ? "found" : "not_found";
    const updatedPerson: Person = { ...item.person, [config.targetField]: value };

    await supabaseAdmin.from("enrichment_results").insert({
      run_id: runId,
      list_item_id: item.id,
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
      .eq("id", item.id);

    const { error: resolveError } = await supabaseAdmin.rpc("fn_resolve_row", {
      p_run_id: runId,
      p_list_item_id: item.id,
      p_outcome: outcome,
      p_credits: config.creditsPerReveal,
    });

    if (resolveError) {
      req.log.error({ err: resolveError }, "failed to resolve reveal row");
    }

    resolved.push({ id: item.id, person: updatedPerson });
  }

  return { batchFailed, resolved, affordableCount: maxAffordable, creditSkippedCount };
}

// Fresh selection from a live search result -> creates a brand new list.
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

  const listId = list.id as string;

  const { data: listItems, error: itemsError } = await supabaseAdmin
    .from("list_items")
    .insert(people.map((p) => ({ list_id: listId, user_id: userId, data: p })))
    .select("id");

  if (itemsError || !listItems || listItems.length !== people.length) {
    req.log.error({ err: itemsError }, "failed to create list_items for reveal");
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const items: ListItemRef[] = people.map((p, i) => ({ id: listItems[i].id as string, person: p }));
  const result = await holdCallResolve(req, userId, listId, items, config);

  if (result.batchFailed) {
    return res.status(502).json({ error: `${config.providerName} provider failed, credits released` });
  }

  if (result.affordableCount === 0) {
    return res.status(402).json({
      error: `Not enough credits — need at least ${config.creditsPerReveal} to reveal even one.`,
      people,
      skipped_count: items.length,
    });
  }

  const resolvedMap = new Map(result.resolved.map((r) => [r.id, r.person]));
  const finalResults = items.map((item) => resolvedMap.get(item.id) ?? item.person);

  return res.json({ people: finalResults, list_id: listId, skipped_count: result.creditSkippedCount });
}

// Re-run on rows already saved in a list — skips rows that already have the
// target field filled in, so you're never re-charged for what's done.
export async function runListRevealBatch(req: Request, res: Response, config: RevealConfig) {
  const webhookUrl = process.env[config.webhookEnvVar];
  if (!webhookUrl) {
    return res.status(500).json({ error: config.notConfiguredError });
  }

  const body = (req.body ?? {}) as { list_item_ids?: string[] };
  const requestedIds = Array.isArray(body.list_item_ids) ? body.list_item_ids.slice(0, MAX_ROWS_PER_REQUEST) : [];

  if (requestedIds.length === 0) {
    return res.status(400).json({ error: "Select at least one row" });
  }

  const userId = req.user!.id;

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from("list_items")
    .select("id, list_id, data")
    .in("id", requestedIds)
    .eq("user_id", userId);

  if (fetchError || !rows || rows.length === 0) {
    return res.status(404).json({ error: "Could not find the selected rows" });
  }

  const listId = rows[0].list_id as string;

  let alreadyDoneCount = 0;
  const candidates: ListItemRef[] = [];
  for (const row of rows) {
    const person = row.data as Person;
    const value = person?.[config.targetField];
    if (typeof value === "string" && value.trim()) {
      alreadyDoneCount++;
    } else {
      candidates.push({ id: row.id as string, person });
    }
  }

  if (candidates.length === 0) {
    return res.json({
      updated_count: 0,
      already_done_count: alreadyDoneCount,
      skipped_count: 0,
    });
  }

  const result = await holdCallResolve(req, userId, listId, candidates, config);

  if (result.batchFailed) {
    return res.status(502).json({ error: `${config.providerName} provider failed, credits released` });
  }

  if (result.affordableCount === 0) {
    return res.status(402).json({
      error: `Not enough credits — need at least ${config.creditsPerReveal} to reveal even one.`,
    });
  }

  return res.json({
    updated_count: result.resolved.length,
    already_done_count: alreadyDoneCount,
    skipped_count: result.creditSkippedCount,
  });
}
