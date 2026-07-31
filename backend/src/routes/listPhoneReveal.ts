import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { runListRevealBatch } from "../lib/revealFlow.js";

const router = Router();

router.post("/hv/list-phone-reveal", requireAuth, enforceAccountStatus(), (req: Request, res: Response) =>
  runListRevealBatch(req, res, {
    webhookEnvVar: "phone_finder_webhook",
    creditsPerReveal: 20,
    runType: "mobile_enrich",
    targetField: "Phone",
    providerName: "phone_finder",
    notConfiguredError: "phone_finder_webhook not configured",
  }),
);

export default router;
