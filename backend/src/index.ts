import "dotenv/config";
import express from "express";
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

app.use(express.json());

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

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  logger.info(`api listening on :${port}`);
});
