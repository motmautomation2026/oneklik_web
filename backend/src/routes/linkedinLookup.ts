import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { normalizePerson, type Person } from "../lib/revealFlow.js";
import { ensureSubscriptionCreditState } from "../lib/ensureSubscription.js";
import { setLinkedinContactCache } from "../lib/linkedinContactCache.js";

const router = Router();

const MAX_URLS_PER_REQUEST = 50;

// Profile lookup only — free. Email and phone are reveal-gated behind
// /hv/linkedin-email-reveal and /hv/linkedin-phone-reveal so a user only
// pays for the field they actually click to reveal, never both bundled.
router.post("/hv/linkedin-lookup", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
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
  await ensureSubscriptionCreditState(userId, req.log);

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

  let people: Person[] = [];
  try {
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedin_urls: linkedinUrls }),
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
    // n8n's free-lookup branch already paid SalesQL for whatever email/phone
    // came back as a byproduct of the profile match, and hands it back here
    // as hidden _WORK_EMAIL / _PHONE_RAW fields (never as EMAIL/PHONE, which
    // stay blank). Cache it per-user for a short window so a reveal click
    // for the same profile can skip re-paying a provider for the same data
    // — see linkedinContactCache.ts for why this is intentionally in-memory
    // and short-lived rather than a database table.
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const linkedinUrl = typeof r["USER SOCIAL"] === "string" ? (r["USER SOCIAL"] as string) : "";
      const workEmail = typeof r["_WORK_EMAIL"] === "string" ? (r["_WORK_EMAIL"] as string) : "";
      const phone = typeof r["_PHONE_RAW"] === "string" ? (r["_PHONE_RAW"] as string) : "";
      if (linkedinUrl && (workEmail || phone)) {
        setLinkedinContactCache(userId, linkedinUrl, { workEmail, phone });
      }
    }

    people = rows
      .map((row) => normalizePerson(row as Record<string, unknown>))
      .filter((p) => p["FULL NAME"].length > 0)
      .slice(0, linkedinUrls.length)
      // Defense in depth: strip contact fields even if the provider response
      // happens to include them — this endpoint must never bill or surface
      // Email/Phone, only the dedicated reveal endpoints do.
      .map((p) => ({ ...p, Email: "", Phone: "" }));
  } catch (err) {
    req.log.error({ err }, "linkedin-lookup webhook call failed");
    return res.status(502).json({ error: "LinkedIn lookup provider failed" });
  }

  return res.json({ people });
});

export default router;
