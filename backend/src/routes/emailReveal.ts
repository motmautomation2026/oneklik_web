import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runRevealBatch } from "../lib/revealFlow.js";

const router = Router();

router.post("/hv/email-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) =>
  runRevealBatch(req, res, {
    webhookEnvVar: "email_finder_webhook",
    creditsPerReveal: 2,
    runType: "email_enrich",
    targetField: "Email",
    listNamePrefix: "Email Reveal",
    providerName: "email_finder",
    notConfiguredError: "email_finder_webhook not configured",
  }),
);

export default router;
