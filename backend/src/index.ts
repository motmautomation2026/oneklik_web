import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import pino from "pino";
import { pinoHttp } from "pino-http";
import companySearchRouter from "./routes/companySearch.js";
import companySearchAiRouter from "./routes/companySearchAi.js";
import peopleSearchRouter from "./routes/peopleSearch.js";
import peopleSearchAiRouter from "./routes/peopleSearchAi.js";
import emailRevealRouter from "./routes/emailReveal.js";
import phoneRevealRouter from "./routes/phoneReveal.js";
import listEmailRevealRouter from "./routes/listEmailReveal.js";
import listPhoneRevealRouter from "./routes/listPhoneReveal.js";
import linkedinLookupRouter from "./routes/linkedinLookup.js";
import prospeoSuggestionsRouter from "./routes/prospeoSuggestions.js";
import mergeListsRouter from "./routes/mergeLists.js";
import razorpayWebhookRouter from "./routes/razorpayWebhook.js";
import paymentsCheckoutRouter from "./routes/paymentsCheckout.js";
import billingProfileRouter from "./routes/billingProfile.js";
import invoicesRouter from "./routes/invoices.js";
import billingTickRouter from "./routes/billingTick.js";
import billingSubscriptionRouter from "./routes/billingSubscription.js";
import supportRouter from "./support/routes.js";
import adminRouter from "./admin/routes.js";
import emailTemplatesRouter from "./routes/emailTemplates.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();

app.use(cors());
app.use(pinoHttp({ logger }));

// Registered before express.json() deliberately — this route needs the raw
// request body (for HMAC signature verification), and once express.json()
// consumes the body as parsed JSON, the original bytes are gone.
app.use("/api", razorpayWebhookRouter);

// 2mb comfortably covers the largest legitimate payload we send (a 50-row
// reveal batch, capped client-side to match MAX_ROWS_PER_REQUEST) while
// still rejecting anything pathological. Bumped from the 100kb default that
// silently 413'd a 100-person reveal request before it reached any route.
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", companySearchRouter);
app.use("/api", companySearchAiRouter);
app.use("/api", peopleSearchRouter);
app.use("/api", peopleSearchAiRouter);
app.use("/api", emailRevealRouter);
app.use("/api", phoneRevealRouter);
app.use("/api", listEmailRevealRouter);
app.use("/api", listPhoneRevealRouter);
app.use("/api", linkedinLookupRouter);
app.use("/api", emailTemplatesRouter);
app.use("/api", prospeoSuggestionsRouter);
app.use("/api", mergeListsRouter);
app.use("/api", paymentsCheckoutRouter);
app.use("/api", billingProfileRouter);
app.use("/api", invoicesRouter);
app.use("/api", billingTickRouter);
app.use("/api", billingSubscriptionRouter);
// Authenticated but NOT account-status gated — a frozen, suspended or banned
// user has to be able to raise and read a support ticket. See the comment at
// the top of support/routes.ts before adding any middleware here.
app.use("/api/support", supportRouter);
app.use("/api/admin", adminRouter);

// Catches express.json()'s body-parser failures (oversized or malformed
// body) — without this, Express's default handler sends a bare
// text/html error with no JSON body, and the frontend's apiPost (which
// does `res.json().catch(() => ({}))`) can only fall back to a generic
// "Request failed (413)" with no actionable detail.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "That request is too large — try selecting fewer rows at a time." });
    return;
  }
  if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: "Malformed request body." });
    return;
  }
  next(err);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  logger.info(`api listening on :${port}`);
});
