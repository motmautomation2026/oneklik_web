import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { normalizePerson, type Person } from "../lib/revealFlow.js";

const router = Router();

const MAX_URLS_PER_REQUEST = 50;

router.post("/hv/linkedin-lookup", requireAuth, async (req: Request, res: Response) => {
  const webhookUrl = process.env["linkedin_lookup_webhook"];
  if (!webhookUrl) {
    return res.status(500).json({ error: "linkedin_lookup_webhook not configured" });
  }

  const body = (req.body ?? {}) as { linkedin_urls?: string[] };
  const linkedinUrls = Array.isArray(body.linkedin_urls)
    ? body.linkedin_urls.filter(Boolean).slice(0, MAX_URLS_PER_REQUEST)
    : [];

  if (linkedinUrls.length === 0) {
    return res.status(400).json({ error: "At least one LinkedIn URL is required" });
  }

  const userId = req.user!.id;

  // The lookup itself is free, but a zero balance still shouldn't be able to
  // hit the webhook for free indefinitely — that costs you (n8n/scraping
  // infra) even when nobody ever gets billed. Gate on balance > 0, not on
  // affording any specific reveal amount.
  const { data: gateWallet } = await supabaseAdmin
    .from("credit_wallets")
    .select("available_balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (!gateWallet || gateWallet.available_balance <= 0) {
    return res.status(402).json({ error: "Add credits before running a LinkedIn lookup" });
  }

  // Email and phone are always attempted — no opt-in toggle. The lookup
  // itself is free; only a found email/phone gets billed below.
  let people: Person[] = [];
  try {
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkedin_urls: linkedinUrls,
        include_email: true,
        include_phone: true,
      }),
    });

    if (!n8nRes.ok) {
      const bodyText = await n8nRes.text().catch(() => "");
      req.log.error(
        { status: n8nRes.status, body: bodyText.slice(0, 300) },
        "linkedin-lookup webhook returned non-2xx",
      );
      return res.status(502).json({ error: "LinkedIn lookup provider failed" });
    }

    const data: unknown = await n8nRes.json();
    const rows: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.people)
        ? ((data as Record<string, unknown>).people as unknown[])
        : Array.isArray((data as Record<string, unknown>)?.data)
          ? ((data as Record<string, unknown>).data as unknown[])
          : [];
    people = rows
      .map((row) => normalizePerson(row as Record<string, unknown>))
      .filter((p) => p["FULL NAME"].length > 0)
      .slice(0, linkedinUrls.length);
  } catch (err) {
    req.log.error({ err }, "linkedin-lookup webhook call failed");
    return res.status(502).json({ error: "LinkedIn lookup provider failed" });
  }

  if (people.length === 0) {
    return res.json({ people });
  }

  const { data: list, error: listError } = await supabaseAdmin
    .from("lists")
    .insert({
      user_id: userId,
      name: `LinkedIn Lookup — ${new Date().toISOString().slice(0, 10)}`,
      kind: "people",
    })
    .select("id")
    .single();

  if (listError || !list) {
    req.log.error({ err: listError }, "failed to create linkedin lookup list");
    // Lookup already succeeded and nothing has been billed yet — safe to
    // still return the (unbilled, so redacted) profiles rather than fail.
    return res.json({ people: people.map((p) => ({ ...p, Email: "", Phone: "" })) });
  }

  const { data: listItems, error: itemsError } = await supabaseAdmin
    .from("list_items")
    .insert(people.map((p) => ({ list_id: list.id, user_id: userId, data: p })))
    .select("id");

  if (itemsError || !listItems || listItems.length !== people.length) {
    req.log.error({ err: itemsError }, "failed to create list_items for linkedin lookup");
    return res.json({ people: people.map((p) => ({ ...p, Email: "", Phone: "" })), list_id: list.id });
  }

  // Narrowed, non-null bindings — TS doesn't retain the guard-clause
  // narrowing above across the chargeField closure boundary.
  const listId = list.id as string;
  const confirmedListItems = listItems;

  // Bills a found field (Email or Phone) as an ordinary reveal run — but
  // only for as many rows as the wallet can actually afford, checked
  // upfront. Holding the whole batch's worst-case in one shot meant "2
  // credits available, 2 rows at 2cr each" held for 4, failed outright, and
  // revealed nothing — even though one of those two might have been
  // affordable on its own. Processes rows in order and stops once the
  // budget runs out; returns which rows were actually attempted so the
  // caller can redact just the skipped ones, not the whole field.
  async function chargeField(
    field: "Email" | "Phone",
    creditsEach: number,
    runType: "email_enrich" | "mobile_enrich",
  ): Promise<boolean[]> {
    const attempted = new Array(people.length).fill(false);

    const { data: wallet } = await supabaseAdmin
      .from("credit_wallets")
      .select("available_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const availableBalance = wallet?.available_balance ?? 0;
    const maxAffordable = Math.min(people.length, Math.floor(availableBalance / creditsEach));

    if (maxAffordable === 0) {
      return attempted;
    }

    const { data: chargeRun, error: chargeRunError } = await supabaseAdmin
      .from("enrichment_runs")
      .insert({
        user_id: userId,
        list_id: listId,
        run_type: runType,
        status: "pending",
        requested_count: maxAffordable,
      })
      .select("id")
      .single();

    if (chargeRunError || !chargeRun) {
      req.log.error({ err: chargeRunError }, `failed to create ${runType} run for linkedin lookup`);
      return attempted;
    }

    const chargeRunId = chargeRun.id as string;
    const { error: holdError } = await supabaseAdmin.rpc("fn_hold_credits", {
      p_user_id: userId,
      p_run_id: chargeRunId,
      p_amount: maxAffordable * creditsEach,
    });

    if (holdError) {
      await supabaseAdmin
        .from("enrichment_runs")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", chargeRunId);
      return attempted;
    }

    for (let i = 0; i < maxAffordable; i++) {
      const found = Boolean(people[i][field]);
      const outcome = found ? "found" : "not_found";

      await supabaseAdmin.from("enrichment_results").insert({
        run_id: chargeRunId,
        list_item_id: confirmedListItems[i].id,
        user_id: userId,
        provider: field === "Email" ? "email_finder" : "phone_finder",
        outcome,
        cost: 0,
      });

      const { error: rowResolveError } = await supabaseAdmin.rpc("fn_resolve_row", {
        p_run_id: chargeRunId,
        p_list_item_id: confirmedListItems[i].id,
        p_outcome: outcome,
        p_credits: creditsEach,
      });

      if (rowResolveError) {
        req.log.error({ err: rowResolveError }, `failed to resolve ${field} charge row from linkedin lookup`);
      }

      attempted[i] = true;
    }

    return attempted;
  }

  const emailAttempted = await chargeField("Email", 2, "email_enrich");
  const phoneAttempted = await chargeField("Phone", 3, "mobile_enrich");

  const finalPeople = people.map((p, i) => ({
    ...p,
    Email: emailAttempted[i] ? p.Email : "",
    Phone: phoneAttempted[i] ? p.Phone : "",
  }));

  const emailSkippedCount = emailAttempted.filter((a) => !a).length;
  const phoneSkippedCount = phoneAttempted.filter((a) => !a).length;

  if (emailSkippedCount > 0 || phoneSkippedCount > 0) {
    await supabaseAdmin
      .from("list_items")
      .upsert(
        confirmedListItems.map((item, i) => ({
          id: item.id,
          list_id: listId,
          user_id: userId,
          data: finalPeople[i],
        })),
      );
  }

  return res.json({
    people: finalPeople,
    list_id: listId,
    email_skipped_count: emailSkippedCount,
    phone_skipped_count: phoneSkippedCount,
  });
});

export default router;
