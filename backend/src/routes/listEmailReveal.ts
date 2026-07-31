import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runListRevealBatch } from "../lib/revealFlow.js";

const router = Router();

router.post("/hv/list-email-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) =>
  runListRevealBatch(req, res, {
    webhookEnvVar: "email_finder_webhook",
    creditsPerReveal: 2,
    runType: "email_enrich",
    targetField: "Email",
    providerName: "email_finder",
    notConfiguredError: "email_finder_webhook not configured",
  }),
);

export default router;
