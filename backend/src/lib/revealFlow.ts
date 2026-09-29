import type { Request, Response } from "express";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { ensureSubscriptionCreditState } from "./ensureSubscription.js";

// Configurable via env so ops can tune it without a code change — e.g. to
// work around a provider-side batching quirk without a redeploy. Falls back
// to 50 for any unset/invalid value.
const envBatchSize = Number(process.env["REVEAL_BATCH_SIZE"]);
const MAX_ROWS_PER_REQUEST = Number.isInteger(envBatchSize) && envBatchSize > 0 ? envBatchSize : 50;

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

// Convention: a caller (e.g. linkedinEmailReveal.ts) may attach extra
// underscore-prefixed fields to a person before it's sent to the provider
// webhook — wire-only hints such as a locally cached value, never part of
// the Person shape itself. Stripped before anything reaches list_items so a
// hint never ends up persisted alongside the real, billed result.
function stripHiddenFields(person: Person): Person {
  const clean = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(person)) {
    if (!key.startsWith("_")) clean[key] = value;
  }
  return clean as unknown as Person;
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
  await ensureSubscriptionCreditState(userId, req.log);

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
      // Tags each person with its position in this batch so the response
      // can be matched back by that tag rather than by array position —
      // n8n's internal split/merge for the provider waterfall isn't
      // guaranteed to preserve input order once a batch is large enough to
      // actually get split, and a silent reorder here means row i's result
      // gets written to the wrong person with no error anywhere. Stripped
      // by stripHiddenFields before anything is persisted or returned.
      body: JSON.stringify({ people: toProcess.map((i, idx) => ({ ...i.person, _ROW_INDEX: idx })) }),
    });

    if (n8nRes.ok) {
      const data: unknown = await n8nRes.json();
      responseRows = extractPersonRows(data);

      // No PII here (no names/emails/phones) — just enough to catch a
      // future recurrence of "n8n returned a differently-shaped/shorter
      // response than what we sent" without needing to reach for a raw
      // dump again. Rows below this count fall through to a normal
      // "not found" outcome per-row, so this is purely a signal for
      // debugging, not something the caller needs to act on.
      if (responseRows.length !== toProcess.length) {
        req.log.warn(
          { requestedCount: toProcess.length, responseRowCount: responseRows.length },
          `${config.providerName} webhook returned a different row count than requested`,
        );
      }
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

  // Prefer matching by the _ROW_INDEX tag we sent (see above) over raw
  // array position, so a batch n8n returns out of order still resolves
  // each row against the right person. Only rows with a valid, in-range
  // tag go in the map — anything else falls through to the old positional
  // lookup below, so a webhook that doesn't echo the tag back still works
  // exactly as before.
  const rowsByIndex = new Map<number, Record<string, unknown>>();
  for (const row of responseRows) {
    const idx = Number(row?.["_ROW_INDEX"]);
    if (Number.isInteger(idx) && idx >= 0 && idx < toProcess.length) rowsByIndex.set(idx, row);
  }

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const row = rowsByIndex.get(i) ?? responseRows[i];

    const value = batchFailed ? "" : pickFirstNonEmpty(...fieldCandidates.map((key) => row?.[key]));
    const outcome: "found" | "not_found" | "error" = batchFailed ? "error" : value ? "found" : "not_found";
    const updatedPerson: Person = stripHiddenFields({ ...item.person, [config.targetField]: value });

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

// One evergreen, hidden list per (user, kind) that reveals attach their
// list_items to when the user never explicitly saved a list — see
// 0021_lists_scratch_flag.sql for why this has to exist at all (billing
// needs a persisted list_item row) and why it doesn't need a NEW list every
// time (only the row needs to persist, not a fresh visible list). Created
// lazily on first use, reused forever after, never shown on the Lists page.
export async function getOrCreateScratchList(
  req: Request,
  userId: string,
  kind: "people" | "company",
): Promise<string | null> {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("lists")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("is_system", true)
    .maybeSingle();

  if (findError) {
    req.log.error({ err: findError }, "failed to look up scratch list");
    return null;
  }
  if (existing) return existing.id as string;

  const { data: created, error: createError } = await supabaseAdmin
    .from("lists")
    .insert({ user_id: userId, name: "Unsaved reveals", kind, is_system: true })
    .select("id")
    .single();

  if (createError || !created) {
    // Unique index (one system list per user+kind) means a concurrent
    // request may have created it first — re-read rather than treating a
    // race as a real failure.
    if (createError?.code === "23505") {
      const { data: raced } = await supabaseAdmin
        .from("lists")
        .select("id")
        .eq("user_id", userId)
        .eq("kind", kind)
        .eq("is_system", true)
        .maybeSingle();
      if (raced) return raced.id as string;
    }
    req.log.error({ err: createError }, "failed to create scratch list");
    return null;
  }

  return created.id as string;
}

// Fresh selection from a live search result -> attaches to the user's
// scratch list (see getOrCreateScratchList above) rather than creating a
// new visible list every time.
export async function runRevealBatch(req: Request, res: Response, config: RevealConfig) {
  const webhookUrl = process.env[config.webhookEnvVar];
  if (!webhookUrl) {
    return res.status(500).json({ error: config.notConfiguredError });
  }

  const body = (req.body ?? {}) as { people?: Person[] };
  const rawPeople = Array.isArray(body.people) ? body.people : [];
  const people = rawPeople.slice(0, MAX_ROWS_PER_REQUEST);

  if (people.length === 0) {
    return res.status(400).json({ error: "Select at least one person to reveal" });
  }

  // The frontend is expected to chunk requests to MAX_ROWS_PER_REQUEST
  // itself — this only fires if some caller doesn't, and it must be
  // reported rather than silently dropped, or the caller ends up holding
  // a shorter results array than the row count it selected. That mismatch
  // is exactly what corrupted the People page's saved state in production
  // (rows past the truncation point got written as `undefined`).
  if (rawPeople.length > MAX_ROWS_PER_REQUEST) {
    return res.status(400).json({
      error: `Reveal at most ${MAX_ROWS_PER_REQUEST} people per request — select fewer rows or let the app batch them for you.`,
    });
  }

  const userId = req.user!.id;

  const listId = await getOrCreateScratchList(req, userId, "people");
  if (!listId) {
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const { data: listItems, error: itemsError } = await supabaseAdmin
    .from("list_items")
    .insert(people.map((p) => ({ list_id: listId, user_id: userId, data: stripHiddenFields(p) })))
    .select("id");

  if (itemsError || !listItems || listItems.length !== people.length) {
    req.log.error({ err: itemsError }, "failed to create list_items for reveal");
    return res.status(500).json({ error: "Could not start reveal" });
  }

  const items: ListItemRef[] = people.map((p, i) => ({ id: listItems[i].id as string, person: p }));
  const result = await holdCallResolve(req, userId, listId, items, config);

  // Fatal before any row was resolved (couldn't create the run / hold credits) —
  // a real error, not a "not found". A provider outage that happens *after*
  // credits were held instead resolves each row to "not found" (see
  // holdCallResolve) and releases its hold, so it's reported like a genuine
  // miss below rather than as a hard failure.
  if (result.batchFailed && result.resolved.length === 0) {
    return res.status(502).json({ error: `${config.providerName} provider failed, credits released` });
  }

  if (result.affordableCount === 0) {
    return res.status(402).json({
      error: `Not enough credits — need at least ${config.creditsPerReveal} to reveal even one.`,
      people: people.map(stripHiddenFields),
      skipped_count: items.length,
    });
  }

  // Falls back to the original request-side person for any row holdCallResolve
  // never resolved (e.g. skipped for affordability) — stripped the same as a
  // resolved row, so an unbilled row can never carry a wire-only hint (like a
  // cached reveal value) back out to the caller.
  const resolvedMap = new Map(result.resolved.map((r) => [r.id, r.person]));
  const finalResults = items.map((item) => resolvedMap.get(item.id) ?? stripHiddenFields(item.person));

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
  const rawIds = Array.isArray(body.list_item_ids) ? body.list_item_ids : [];
  const requestedIds = rawIds.slice(0, MAX_ROWS_PER_REQUEST);

  if (requestedIds.length === 0) {
    return res.status(400).json({ error: "Select at least one row" });
  }

  if (rawIds.length > MAX_ROWS_PER_REQUEST) {
    return res.status(400).json({
      error: `Reveal at most ${MAX_ROWS_PER_REQUEST} rows per request — select fewer rows or let the app batch them for you.`,
    });
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

  if (result.batchFailed && result.resolved.length === 0) {
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
