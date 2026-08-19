import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runRevealBatch } from "../lib/revealFlow.js";
import { getLinkedinContactCache } from "../lib/linkedinContactCache.js";

const router = Router();

// Dedicated to LinkedIn Lookup — hits the phone waterfall built into
// OK_Linkedin-Lookup.json (SalesQL -> Prospeo), kept separate from People
// Search's phone_finder_webhook so the two providers can evolve
// independently.
router.post("/hv/linkedin-phone-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) => {
  // See linkedinEmailReveal.ts for why this hint exists and why a miss here
  // is harmless — it just falls back to the normal paid waterfall.
  const body = req.body as { people?: Record<string, unknown>[] } | undefined;
  if (Array.isArray(body?.people)) {
    const userId = req.user!.id;
    for (const person of body.people) {
      if (!person || typeof person !== "object") continue;
      const linkedinUrl = typeof person["USER SOCIAL"] === "string" ? (person["USER SOCIAL"] as string) : "";
      if (!linkedinUrl) continue;
      const cached = getLinkedinContactCache(userId, linkedinUrl);
      if (cached?.phone) person["_CACHED_PHONE"] = cached.phone;
    }
  }

  return runRevealBatch(req, res, {
    webhookEnvVar: "linkedin_phone_reveal_webhook",
    creditsPerReveal: 20,
    runType: "mobile_enrich",
    targetField: "Phone",
    providerName: "linkedin_phone_finder",
    notConfiguredError: "linkedin_phone_reveal_webhook not configured",
  });
});

export default router;
