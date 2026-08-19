import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runRevealBatch } from "../lib/revealFlow.js";
import { getLinkedinContactCache } from "../lib/linkedinContactCache.js";

const router = Router();

// Dedicated to LinkedIn Lookup — hits the email waterfall built into
// OK_Linkedin-Lookup.json (Kitt AI -> SalesQL -> Prospeo), kept separate from
// People Search's email_finder_webhook so the two providers can evolve
// independently.
router.post("/hv/linkedin-email-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) => {
  // Tag any person we already have a cached work email for (byproduct of
  // this user's own recent free lookup) with a hidden hint — n8n's waterfall
  // checks it first and skips straight to a result instead of re-paying
  // Kitt AI / SalesQL / Prospeo for data we already have. A miss here just
  // means the normal waterfall runs, so this is purely a cost optimization,
  // never a correctness dependency. The hint itself never reaches storage —
  // see stripHiddenFields in revealFlow.ts.
  const body = req.body as { people?: Record<string, unknown>[] } | undefined;
  if (Array.isArray(body?.people)) {
    const userId = req.user!.id;
    for (const person of body.people) {
      if (!person || typeof person !== "object") continue;
      const linkedinUrl = typeof person["USER SOCIAL"] === "string" ? (person["USER SOCIAL"] as string) : "";
      if (!linkedinUrl) continue;
      const cached = getLinkedinContactCache(userId, linkedinUrl);
      if (cached?.workEmail) person["_CACHED_EMAIL"] = cached.workEmail;
    }
  }

  return runRevealBatch(req, res, {
    webhookEnvVar: "linkedin_email_reveal_webhook",
    creditsPerReveal: 2,
    runType: "email_enrich",
    targetField: "Email",
    providerName: "linkedin_email_finder",
    notConfiguredError: "linkedin_email_reveal_webhook not configured",
  });
});

export default router;
