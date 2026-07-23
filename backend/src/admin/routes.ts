import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "./middleware.js";
import {
  getAdmins,
  getAllTransactionsForExport,
  getAllUsersForExport,
  getFeatureUsage,
  getFunnel,
  getLists,
  getListsActivity,
  getOverview,
  getRuns,
  getRunsKpis,
  getSystemHealth,
  getTopCompanies,
  getTransactions,
  getTransactionsKpis,
  getTrends,
  getUseCaseBreakdown,
  getUserDetail,
  getUserLedger,
  getUsers,
  getUsersKpis,
  reviewFlaggedAccount,
} from "./queries.js";
import type { FlaggedStatus, PaymentRow, PaymentStatus, RunStatus } from "./types.js";

const router = Router();

// Every route below is admin-only — applied once here rather than per-route
// so a new route can't accidentally be added without the gate.
router.use(requireAuth, requireAdmin);

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const PAYMENT_STATUSES: PaymentStatus[] = ["initiated", "pending", "success", "failed"];

function paymentStatusParam(value: unknown): PaymentStatus | undefined {
  return typeof value === "string" && (PAYMENT_STATUSES as string[]).includes(value)
    ? (value as PaymentStatus)
    : undefined;
}

const RUN_STATUSES: RunStatus[] = ["pending", "running", "completed", "cancelled", "failed"];

function runStatusParam(value: unknown): RunStatus | undefined {
  return typeof value === "string" && (RUN_STATUSES as string[]).includes(value) ? (value as RunStatus) : undefined;
}

// Minimal CSV writer for the export routes — escapes commas/quotes/newlines
// per RFC 4180. Some exported fields (profiles.company, in particular) are
// free-text user input, so a value starting with =/+/-/@ is neutralized
// with a leading apostrophe first — otherwise Excel/Sheets can interpret it
// as a formula when the file is opened (CSV injection).
function rowsToCsv<T>(columns: { header: string; value: (row: T) => string | number }[], rows: T[]): string {
  const escape = (value: string | number): string => {
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escape(c.value(row))).join(","));
  return [header, ...lines].join("\r\n");
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const overview = await getOverview();
    return res.json(overview);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load overview");
    return res.status(500).json({ error: "Could not load overview" });
  }
});

router.get("/trends", async (req: Request, res: Response) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  try {
    const trends = await getTrends(days);
    return res.json({ days, trends });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load trends");
    return res.status(500).json({ error: "Could not load trends" });
  }
});

router.get("/funnel", async (req: Request, res: Response) => {
  try {
    const funnel = await getFunnel();
    return res.json(funnel);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load funnel");
    return res.status(500).json({ error: "Could not load funnel" });
  }
});

router.get("/system-health", async (req: Request, res: Response) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  try {
    const health = await getSystemHealth(days);
    return res.json({ days, ...health });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load system health");
    return res.status(500).json({ error: "Could not load system health" });
  }
});

router.get("/feature-usage", async (req: Request, res: Response) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  try {
    const usage = await getFeatureUsage(days);
    return res.json({ days, usage });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load feature usage");
    return res.status(500).json({ error: "Could not load feature usage" });
  }
});

router.get("/lists-activity", async (req: Request, res: Response) => {
  try {
    const activity = await getListsActivity();
    return res.json(activity);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load lists activity");
    return res.status(500).json({ error: "Could not load lists activity" });
  }
});

router.get("/use-case-breakdown", async (req: Request, res: Response) => {
  try {
    const breakdown = await getUseCaseBreakdown();
    return res.json({ breakdown });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load use-case breakdown");
    return res.status(500).json({ error: "Could not load use-case breakdown" });
  }
});

router.get("/users/kpis", async (req: Request, res: Response) => {
  try {
    const kpis = await getUsersKpis();
    return res.json(kpis);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load user KPIs");
    return res.status(500).json({ error: "Could not load user KPIs" });
  }
});

router.get("/transactions/kpis", async (req: Request, res: Response) => {
  const search = stringParam(req.query.search);
  try {
    const kpis = await getTransactionsKpis({ search });
    return res.json(kpis);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load transaction KPIs");
    return res.status(500).json({ error: "Could not load transaction KPIs" });
  }
});

// Registered before /users/:id — "export" would otherwise be swallowed as
// an :id param, same ordering hazard already noted for /users/kpis.
router.get("/users/export", async (req: Request, res: Response) => {
  const search = stringParam(req.query.search);
  try {
    const rows = await getAllUsersForExport(search);
    const csv = rowsToCsv(
      [
        { header: "Email", value: (r) => r.email ?? "" },
        { header: "Company", value: (r) => r.company ?? "" },
        { header: "Onboarded", value: (r) => (r.onboarded ? "Yes" : "No") },
        { header: "Signed up", value: (r) => r.created_at },
        { header: "Available balance", value: (r) => r.available_balance },
        { header: "Held balance", value: (r) => r.held_balance },
        { header: "Lifetime purchased", value: (r) => r.lifetime_purchased },
        { header: "Lifetime consumed", value: (r) => r.lifetime_consumed },
        { header: "Flagged", value: (r) => (r.is_flagged ? "Yes" : "No") },
      ],
      rows,
    );
    return sendCsv(res, "users.csv", csv);
  } catch (err) {
    req.log.error({ err }, "admin: failed to export users");
    return res.status(500).json({ error: "Could not export users" });
  }
});

router.get("/transactions/export", async (req: Request, res: Response) => {
  const status = paymentStatusParam(req.query.status);
  const search = stringParam(req.query.search);
  try {
    const rows = await getAllTransactionsForExport({ status, search });
    const csv = rowsToCsv<PaymentRow>(
      [
        { header: "Email", value: (r) => r.email ?? r.user_id },
        { header: "Status", value: (r) => r.status },
        { header: "Amount (minor units)", value: (r) => r.amount_minor_units },
        { header: "Currency", value: (r) => r.currency },
        { header: "Credits promised", value: (r) => r.credits_promised },
        { header: "Gateway", value: (r) => r.gateway },
        { header: "Gateway payment id", value: (r) => r.gateway_payment_id ?? "" },
        { header: "Created", value: (r) => r.created_at },
        { header: "Updated", value: (r) => r.updated_at },
      ],
      rows,
    );
    return sendCsv(res, "transactions.csv", csv);
  } catch (err) {
    req.log.error({ err }, "admin: failed to export transactions");
    return res.status(500).json({ error: "Could not export transactions" });
  }
});

router.get("/runs/kpis", async (req: Request, res: Response) => {
  try {
    const kpis = await getRunsKpis();
    return res.json(kpis);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load run KPIs");
    return res.status(500).json({ error: "Could not load run KPIs" });
  }
});

router.get("/runs", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const status = runStatusParam(req.query.status);
  const search = stringParam(req.query.search);
  try {
    const result = await getRuns({ page, pageSize, status, search });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load runs");
    return res.status(500).json({ error: "Could not load runs" });
  }
});

router.get("/lists", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const search = stringParam(req.query.search);
  try {
    const result = await getLists({ page, pageSize, search });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load lists");
    return res.status(500).json({ error: "Could not load lists" });
  }
});

router.get("/companies/top", async (req: Request, res: Response) => {
  const limit = clampInt(req.query.limit, 10, 1, 50);
  try {
    const companies = await getTopCompanies(limit);
    return res.json({ companies });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load top companies");
    return res.status(500).json({ error: "Could not load top companies" });
  }
});

router.get("/admins", async (req: Request, res: Response) => {
  try {
    const admins = await getAdmins();
    return res.json({ admins });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load admins");
    return res.status(500).json({ error: "Could not load admins" });
  }
});

router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const detail = await getUserDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json(detail);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load user detail");
    return res.status(500).json({ error: "Could not load user detail" });
  }
});

router.get("/users/:id/ledger", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  try {
    const ledger = await getUserLedger(req.params.id, { page, pageSize });
    return res.json(ledger);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load user ledger");
    return res.status(500).json({ error: "Could not load user ledger" });
  }
});

const REVIEWABLE_FLAG_STATUSES: FlaggedStatus[] = ["reviewed", "dismissed"];

router.patch("/flagged-accounts/:id", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: string };
  if (!body.status || !(REVIEWABLE_FLAG_STATUSES as string[]).includes(body.status)) {
    return res.status(400).json({ error: "status must be 'reviewed' or 'dismissed'" });
  }
  try {
    await reviewFlaggedAccount(req.params.id, {
      status: body.status as "reviewed" | "dismissed",
      reviewedBy: req.user!.id,
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: failed to review flagged account");
    return res.status(500).json({ error: "Could not update flagged account" });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const search = stringParam(req.query.search);
  try {
    const result = await getUsers({ page, pageSize, search });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load users");
    return res.status(500).json({ error: "Could not load users" });
  }
});

router.get("/transactions", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const status = paymentStatusParam(req.query.status);
  const search = stringParam(req.query.search);
  try {
    const result = await getTransactions({ page, pageSize, status, search });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load transactions");
    return res.status(500).json({ error: "Could not load transactions" });
  }
});

export default router;
