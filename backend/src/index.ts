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

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

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
app.use("/api", prospeoSuggestionsRouter);
app.use("/api", mergeListsRouter);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  logger.info(`api listening on :${port}`);
});
