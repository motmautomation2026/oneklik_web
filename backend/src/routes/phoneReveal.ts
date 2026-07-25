import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runRevealBatch } from "../lib/revealFlow.js";

const router = Router();

router.post("/hv/phone-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) =>
  runRevealBatch(req, res, {
    webhookEnvVar: "phone_finder_webhook",
    creditsPerReveal: 10,
    runType: "mobile_enrich",
    targetField: "Phone",
    listNamePrefix: "Phone Reveal",
    providerName: "phone_finder",
    notConfiguredError: "phone_finder_webhook not configured",
  }),
);

export default router;
