import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "./middleware.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
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
  getUserModerationActions,
  getUsers,
  getUsersKpis,
  grantUserCredits,
  MAX_ADMIN_CREDIT_GRANT,
  MIN_ADMIN_CREDIT_GRANT_REASON_LENGTH,
  reviewFlaggedAccount,
  setUserAccountStatus,
} from "./queries.js";
import { randomUUID } from "node:crypto";
import {
  getAdminInvoiceById,
  getAllInvoicesForExport,
  getInvoices,
  getInvoicesKpis,
  getSubscriptions,
  getSubscriptionsKpis,
} from "./billingQueries.js";
import {
  ensureInvoicePdf,
  renderInvoiceDocument,
  resolveDocumentView,
} from "../lib/issueInvoice.js";
import {
  addAdminMessage,
  getAdminAttachmentUrl,
  getSupportBadgeCount,
  getSupportKpis,
  getSupportTicketDetail,
  getSupportTicketEvents,
  getSupportTicketMessages,
  getSupportTickets,
  getSupportTicketsForExport,
  markTicketReadByAdmin,
  setSupportMute,
  updateSupportTicket,
  type AdminTicketRow,
} from "./supportQueries.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS } from "./exportLimits.js";
import {
  MAX_BODY_LENGTH,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "../support/types.js";
import type {
  AccountStatus,
  AdminInvoiceListRow,
  FlaggedStatus,
  InvoiceDocumentType,
  InvoiceStatus,
  ModerationAction,
  PaymentRow,
  PaymentStatus,
  RunStatus,
  SubscriptionStatus,
} from "./types.js";

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

const ACCOUNT_STATUSES: AccountStatus[] = ["active", "frozen", "suspended", "banned"];

function accountStatusParam(value: unknown): AccountStatus | undefined {
  return typeof value === "string" && (ACCOUNT_STATUSES as string[]).includes(value)
    ? (value as AccountStatus)
    : undefined;
}

const MODERATION_ACTIONS: ModerationAction[] = ["freeze", "suspend", "ban", "reactivate"];

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
        { header: "Plan", value: (r) => r.plan_id ?? "" },
        { header: "Subscription status", value: (r) => r.subscription_status ?? "" },
      ],
      rows,
    );
    return sendCsv(res, "users.csv", csv);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return res.status(413).json({
        error: `That's ${err.total.toLocaleString()} users, more than the ${MAX_EXPORT_ROWS.toLocaleString()} this export supports. Narrow the search and try again.`,
      });
    }
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
        { header: "Invoice number", value: (r) => r.invoice_number ?? "" },
        { header: "Receipt number", value: (r) => r.receipt_number ?? "" },
        { header: "Created", value: (r) => r.created_at },
        { header: "Updated", value: (r) => r.updated_at },
      ],
      rows,
    );
    return sendCsv(res, "transactions.csv", csv);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return res.status(413).json({
        error: `That's ${err.total.toLocaleString()} transactions, more than the ${MAX_EXPORT_ROWS.toLocaleString()} this export supports. Narrow the filters and try again.`,
      });
    }
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
  const userId = stringParam(req.query.userId);
  try {
    const result = await getLists({ page, pageSize, search, userId });
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

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ["active", "past_due", "expired", "cancelled"];

function subscriptionStatusParam(value: unknown): SubscriptionStatus | undefined {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as string[]).includes(value)
    ? (value as SubscriptionStatus)
    : undefined;
}

function planIdParam(value: unknown): string | undefined {
  const v = stringParam(value);
  if (!v) return undefined;
  if (!["starter", "growth", "business"].includes(v)) return undefined;
  return v;
}

const INVOICE_DOCUMENT_TYPES: InvoiceDocumentType[] = ["tax_invoice", "credit_note", "proforma_invoice"];
const INVOICE_STATUSES: InvoiceStatus[] = ["issued", "cancelled", "paid", "void"];

function invoiceDocumentTypeParam(value: unknown): InvoiceDocumentType | undefined {
  return typeof value === "string" && (INVOICE_DOCUMENT_TYPES as string[]).includes(value)
    ? (value as InvoiceDocumentType)
    : undefined;
}

function invoiceStatusParam(value: unknown): InvoiceStatus | undefined {
  return typeof value === "string" && (INVOICE_STATUSES as string[]).includes(value)
    ? (value as InvoiceStatus)
    : undefined;
}

// Literal /subscriptions/kpis before any future /subscriptions/:id.
router.get("/subscriptions/kpis", async (req: Request, res: Response) => {
  try {
    const kpis = await getSubscriptionsKpis();
    return res.json(kpis);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load subscription KPIs");
    return res.status(500).json({ error: "Could not load subscription KPIs" });
  }
});

router.get("/subscriptions", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const status = subscriptionStatusParam(req.query.status);
  const planId = planIdParam(req.query.planId);
  const search = stringParam(req.query.search);
  const lapsingSoon = req.query.lapsingSoon === "1" || req.query.lapsingSoon === "true";
  try {
    const result = await getSubscriptions({ page, pageSize, status, planId, search, lapsingSoon });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load subscriptions");
    return res.status(500).json({ error: "Could not load subscriptions" });
  }
});

// Literal /invoices/kpis and /invoices/export before /invoices/:id.
router.get("/invoices/kpis", async (_req: Request, res: Response) => {
  try {
    const kpis = await getInvoicesKpis();
    return res.json(kpis);
  } catch (err) {
    _req.log.error({ err }, "admin: failed to load invoice KPIs");
    return res.status(500).json({ error: "Could not load invoice KPIs" });
  }
});

router.get("/invoices/export", async (req: Request, res: Response) => {
  const documentType = invoiceDocumentTypeParam(req.query.documentType);
  const status = invoiceStatusParam(req.query.status);
  const search = stringParam(req.query.search);
  const planId = planIdParam(req.query.planId);
  const financialYear = stringParam(req.query.financialYear);
  const issuedFrom = stringParam(req.query.issuedFrom);
  const issuedTo = stringParam(req.query.issuedTo);
  try {
    const rows = await getAllInvoicesForExport({
      documentType,
      status,
      search,
      planId,
      financialYear,
      issuedFrom,
      issuedTo,
    });
    const csv = rowsToCsv<AdminInvoiceListRow>(
      [
        { header: "Issued at", value: (r) => r.issued_at },
        { header: "Document type", value: (r) => r.document_type },
        { header: "Invoice number", value: (r) => r.invoice_number },
        { header: "Receipt number", value: (r) => r.receipt_number ?? "" },
        { header: "Status", value: (r) => r.status },
        { header: "Email", value: (r) => r.email ?? r.user_id },
        { header: "Buyer legal name", value: (r) => r.buyer_legal_name ?? "" },
        { header: "Buyer GSTIN", value: (r) => r.buyer_gstin ?? "" },
        { header: "Plan", value: (r) => r.plan_name ?? r.pack_id ?? "" },
        { header: "Billing intent", value: (r) => r.billing_intent ?? "" },
        { header: "Financial year", value: (r) => r.financial_year },
        { header: "Series", value: (r) => r.series },
        { header: "Taxable (minor units)", value: (r) => r.taxable_value_minor },
        { header: "CGST (minor units)", value: (r) => r.cgst_minor },
        { header: "SGST (minor units)", value: (r) => r.sgst_minor },
        { header: "IGST (minor units)", value: (r) => r.igst_minor },
        { header: "Total (minor units)", value: (r) => r.total_minor },
        { header: "Currency", value: (r) => r.currency },
        { header: "Razorpay capture id", value: (r) => r.gateway_capture_id ?? "" },
        { header: "Payment id", value: (r) => r.payment_id ?? "" },
        { header: "Due date", value: (r) => r.due_date ?? "" },
      ],
      rows,
    );
    return sendCsv(res, "invoices.csv", csv);
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return res.status(413).json({
        error: `That's ${err.total.toLocaleString()} invoices, more than the ${MAX_EXPORT_ROWS.toLocaleString()} this export supports. Narrow the filters and try again.`,
      });
    }
    req.log.error({ err }, "admin: failed to export invoices");
    return res.status(500).json({ error: "Could not export invoices" });
  }
});

router.get("/invoices", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const documentType = invoiceDocumentTypeParam(req.query.documentType);
  const status = invoiceStatusParam(req.query.status);
  const search = stringParam(req.query.search);
  const planId = planIdParam(req.query.planId);
  const financialYear = stringParam(req.query.financialYear);
  const issuedFrom = stringParam(req.query.issuedFrom);
  const issuedTo = stringParam(req.query.issuedTo);
  try {
    const result = await getInvoices({
      page,
      pageSize,
      documentType,
      status,
      search,
      planId,
      financialYear,
      issuedFrom,
      issuedTo,
    });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load invoices");
    return res.status(500).json({ error: "Could not load invoices" });
  }
});

router.get("/invoices/:id", async (req: Request, res: Response) => {
  try {
    const invoice = await getAdminInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    return res.json({
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        document_type: invoice.document_type,
        status: invoice.status,
        total_minor: invoice.total_minor,
        currency: invoice.currency,
        issued_at: invoice.issued_at,
        due_date: invoice.due_date ?? null,
        series: invoice.series,
        receipt_number: invoice.receipt_number ?? null,
        user_id: invoice.user_id,
      },
    });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load invoice");
    return res.status(500).json({ error: "Could not load invoice" });
  }
});

router.get("/invoices/:id/html", async (req: Request, res: Response) => {
  try {
    const invoice = await getAdminInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    let buyerEmail: string | null = null;
    if (invoice.user_id) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(invoice.user_id as string);
      buyerEmail = data.user?.email ?? null;
    }

    const view = resolveDocumentView(invoice, typeof req.query.view === "string" ? req.query.view : null);
    const html = renderInvoiceDocument(invoice, buyerEmail, view);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(html);
  } catch (err) {
    req.log.error({ err }, "admin: failed to render invoice HTML");
    return res.status(500).json({ error: "Could not render invoice" });
  }
});

router.get("/invoices/:id/pdf", async (req: Request, res: Response) => {
  try {
    const invoice = await getAdminInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const view = resolveDocumentView(invoice, typeof req.query.view === "string" ? req.query.view : null);

    // Prefer the cached PDF when it matches the primary view for this document —
    // avoids regenerating + rewriting storage/DB on every admin click.
    const cachedPath = invoice.pdf_storage_path;
    const canReuseCache =
      Boolean(cachedPath) &&
      ((view === "receipt" && invoice.document_type === "tax_invoice") ||
        (view === "proforma" && invoice.document_type === "proforma_invoice"));

    let path: string;
    let filename: string;
    if (canReuseCache && cachedPath) {
      path = cachedPath;
      filename = cachedPath.split("/").pop() ?? `${invoice.invoice_number}.pdf`;
    } else {
      ({ path, filename } = await ensureInvoicePdf(invoice, view));
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage.from("invoices").createSignedUrl(path, 60);

    if (signError || !signed?.signedUrl) {
      // Cached path may be stale — fall through to regenerate once.
      if (canReuseCache) {
        ({ path, filename } = await ensureInvoicePdf(invoice, view));
        const retry = await supabaseAdmin.storage.from("invoices").createSignedUrl(path, 60);
        if (retry.error || !retry.data?.signedUrl) {
          req.log.error({ err: retry.error ?? signError }, "admin: failed to sign invoice PDF URL");
          return res.status(500).json({ error: "Could not prepare PDF download" });
        }
        return res.json({
          url: retry.data.signedUrl,
          filename,
          view,
          expires_in: 60,
        });
      }
      req.log.error({ err: signError }, "admin: failed to sign invoice PDF URL");
      return res.status(500).json({ error: "Could not prepare PDF download" });
    }

    return res.json({
      url: signed.signedUrl,
      filename,
      view,
      expires_in: 60,
    });
  } catch (err) {
    req.log.error({ err }, "admin: invoice PDF generation failed");
    return res.status(503).json({
      error: "PDF generation is temporarily unavailable. You can still view the invoice HTML.",
    });
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

router.get("/users/:id/moderation", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  try {
    const moderation = await getUserModerationActions(req.params.id, { page, pageSize });
    return res.json(moderation);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load user moderation history");
    return res.status(500).json({ error: "Could not load moderation history" });
  }
});

// Grant-only credit compensation (admin_adjustment ledger row). Debits, plan
// changes, and money refunds are intentionally out of scope.
router.post("/users/:id/credits", async (req: Request, res: Response) => {
  const targetId = req.params.id;
  const actorId = req.user!.id;
  const body = (req.body ?? {}) as { amount?: unknown; reason?: unknown; reason_code?: unknown };

  const amountRaw = body.amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? Number(amountRaw)
        : NaN;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive integer" });
  }
  if (amount > MAX_ADMIN_CREDIT_GRANT) {
    return res.status(400).json({
      error: `amount cannot exceed ${MAX_ADMIN_CREDIT_GRANT.toLocaleString("en-IN")} credits per grant`,
    });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_ADMIN_CREDIT_GRANT_REASON_LENGTH) {
    return res.status(400).json({
      error: `A reason of at least ${MIN_ADMIN_CREDIT_GRANT_REASON_LENGTH} characters is required`,
    });
  }

  const reasonCodeRaw = typeof body.reason_code === "string" ? body.reason_code.trim() : "";
  const reasonCode = reasonCodeRaw || "admin_grant";
  if (reasonCode.length > 64) {
    return res.status(400).json({ error: "reason_code is too long" });
  }

  const referenceId = randomUUID();

  try {
    const result = await grantUserCredits({
      userId: targetId,
      amount,
      reason,
      reasonCode,
      actedBy: actorId,
      referenceId,
    });

    if (!result.ok) {
      if (result.reason === "not_found") return res.status(404).json({ error: "User not found" });
      return res.status(404).json({ error: "Wallet not found for user" });
    }

    req.log.info(
      {
        userId: targetId,
        amount: result.amount,
        actedBy: actorId,
        referenceId: result.reference_id,
        availableBalance: result.available_balance,
      },
      "admin: credit grant applied",
    );

    return res.json({
      ok: true,
      available_balance: result.available_balance,
      reference_id: result.reference_id,
      amount: result.amount,
    });
  } catch (err) {
    req.log.error({ err, userId: targetId, amount, referenceId }, "admin: failed to grant credits");
    return res.status(500).json({ error: "Could not grant credits" });
  }
});

// Freeze / suspend / ban / reactivate a user. Guards: a reason is required
// for any restrictive action; `until` (a future ISO timestamp) only applies
// to 'suspend'; an admin can moderate neither themselves nor another admin
// (the latter is enforced in setUserAccountStatus against the DB).
router.patch("/users/:id/status", async (req: Request, res: Response) => {
  const targetId = req.params.id;
  const actorId = req.user!.id;
  const body = (req.body ?? {}) as { action?: string; reason?: string; until?: string };

  if (!body.action || !(MODERATION_ACTIONS as string[]).includes(body.action)) {
    return res.status(400).json({ error: "action must be one of: freeze, suspend, ban, reactivate" });
  }
  const action = body.action as ModerationAction;

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (action !== "reactivate" && !reason) {
    return res.status(400).json({ error: "A reason is required to freeze, suspend, or ban a user" });
  }

  let suspendedUntil: string | null = null;
  if (action === "suspend" && body.until != null && body.until !== "") {
    const parsed = new Date(body.until);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "until must be a valid date" });
    }
    if (parsed.getTime() <= Date.now()) {
      return res.status(400).json({ error: "until must be a future date" });
    }
    suspendedUntil = parsed.toISOString();
  }

  if (targetId === actorId) {
    return res.status(400).json({ error: "You can't change your own account status" });
  }

  try {
    const result = await setUserAccountStatus({
      userId: targetId,
      action,
      reason: reason || null,
      suspendedUntil,
      actedBy: actorId,
    });

    if (!result.ok) {
      if (result.reason === "not_found") return res.status(404).json({ error: "User not found" });
      return res.status(403).json({ error: "You can't change another admin's account status" });
    }

    return res.json({
      ok: true,
      previous_status: result.previous_status,
      new_status: result.new_status,
    });
  } catch (err) {
    req.log.error({ err }, "admin: failed to change user status");
    return res.status(500).json({ error: "Could not change user status" });
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
  const status = accountStatusParam(req.query.status);
  try {
    const result = await getUsers({ page, pageSize, search, status });
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

// ── support tickets ─────────────────────────────────────────────────────
// Ordering note, same hazard as /users/kpis and /users/export above: every
// literal path segment must be registered before /support/:id, or Express
// matches it as an :id. The attachment route is deliberately mounted at
// /support-attachments rather than /support/attachments so it cannot collide
// with a ticket id at all.

function ticketStatusParam(value: unknown): TicketStatus | undefined {
  return typeof value === "string" && (TICKET_STATUSES as string[]).includes(value) ? (value as TicketStatus) : undefined;
}

function ticketCategoryParam(value: unknown): TicketCategory | undefined {
  return typeof value === "string" && (TICKET_CATEGORIES as string[]).includes(value)
    ? (value as TicketCategory)
    : undefined;
}

function ticketPriorityParam(value: unknown): TicketPriority | undefined {
  return typeof value === "string" && (TICKET_PRIORITIES as string[]).includes(value)
    ? (value as TicketPriority)
    : undefined;
}

function boolParam(value: unknown): boolean {
  return value === "1" || value === "true";
}

function supportFiltersFromQuery(query: Record<string, unknown>) {
  return {
    status: ticketStatusParam(query.status),
    category: ticketCategoryParam(query.category),
    priority: ticketPriorityParam(query.priority),
    assignedTo: stringParam(query.assignedTo),
    unassignedOnly: boolParam(query.unassigned),
    unansweredOnly: boolParam(query.unanswered),
    openOnly: boolParam(query.openOnly),
    search: stringParam(query.search),
  };
}

router.get("/support/kpis", async (req: Request, res: Response) => {
  try {
    return res.json(await getSupportKpis());
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support KPIs");
    return res.status(500).json({ error: "Could not load support KPIs" });
  }
});

// Drives the sidebar badge — polled, so kept as cheap as a single count.
router.get("/support/badge", async (req: Request, res: Response) => {
  try {
    return res.json({ count: await getSupportBadgeCount() });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support badge count");
    return res.status(500).json({ error: "Could not load support badge count" });
  }
});

router.get("/support/export", async (req: Request, res: Response) => {
  try {
    const rows = await getSupportTicketsForExport(supportFiltersFromQuery(req.query as Record<string, unknown>));
    const csv = rowsToCsv<AdminTicketRow>(
      [
        { header: "Ticket", value: (r) => `#${r.ticket_number}` },
        { header: "Subject", value: (r) => r.subject },
        { header: "Requester", value: (r) => r.email ?? r.user_id },
        { header: "Category", value: (r) => r.category },
        { header: "Status", value: (r) => r.status },
        { header: "Priority", value: (r) => r.priority },
        { header: "Assignee", value: (r) => r.assigned_to_email ?? "" },
        { header: "Account status at submit", value: (r) => r.account_status_at_submit },
        { header: "Source", value: (r) => r.source },
        { header: "Created", value: (r) => r.created_at },
        { header: "Last activity", value: (r) => r.last_message_at },
        { header: "First response", value: (r) => r.first_response_at ?? "" },
        { header: "Awaiting reply", value: (r) => (r.awaiting_reply ? "Yes" : "No") },
      ],
      rows,
    );
    return sendCsv(res, "support-tickets.csv", csv);
  } catch (err) {
    // Refusing is deliberate — a silently truncated CSV looks complete.
    if (err instanceof ExportTooLargeError) {
      return res.status(413).json({
        error: `That's ${err.total.toLocaleString()} tickets, more than the ${MAX_EXPORT_ROWS.toLocaleString()} this export supports. Narrow the filters (a status, a date-bounded search, or one assignee) and try again.`,
      });
    }
    req.log.error({ err }, "admin: failed to export support tickets");
    return res.status(500).json({ error: "Could not export support tickets" });
  }
});

router.get("/support-attachments/:id/url", async (req: Request, res: Response) => {
  try {
    const url = await getAdminAttachmentUrl(req.params.id);
    if (!url) return res.status(404).json({ error: "Attachment not found" });
    return res.json({ url });
  } catch (err) {
    req.log.error({ err }, "admin: failed to sign support attachment url");
    return res.status(500).json({ error: "Could not open the attachment" });
  }
});

router.get("/support", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  try {
    const result = await getSupportTickets({
      page,
      pageSize,
      ...supportFiltersFromQuery(req.query as Record<string, unknown>),
    });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support tickets");
    return res.status(500).json({ error: "Could not load support tickets" });
  }
});

router.get("/support/:id", async (req: Request, res: Response) => {
  try {
    const ticket = await getSupportTicketDetail(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    return res.json({ ticket });
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support ticket");
    return res.status(500).json({ error: "Could not load the ticket" });
  }
});

router.get("/support/:id/messages", async (req: Request, res: Response) => {
  const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
  const limit = clampInt(req.query.limit, 50, 1, 100);
  try {
    const result = await getSupportTicketMessages(req.params.id, before, limit);
    if (!result) return res.status(404).json({ error: "Ticket not found" });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support messages");
    return res.status(500).json({ error: "Could not load messages" });
  }
});

router.get("/support/:id/events", async (req: Request, res: Response) => {
  const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
  const limit = clampInt(req.query.limit, 50, 1, 100);
  try {
    const result = await getSupportTicketEvents(req.params.id, before, limit);
    if (!result) return res.status(404).json({ error: "Ticket not found" });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "admin: failed to load support events");
    return res.status(500).json({ error: "Could not load events" });
  }
});

// The internal/public distinction is carried explicitly as a boolean and is
// never inferred. `internal: true` is only honored when it arrives as a real
// boolean, so a malformed or missing field fails toward the safe outcome of a
// note the customer would have seen anyway — never the reverse.
router.post("/support/:id/messages", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { body?: string; internal?: boolean };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return res.status(400).json({ error: "A message is required" });
  if (text.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_BODY_LENGTH} characters or fewer` });
  }
  if (body.internal !== undefined && typeof body.internal !== "boolean") {
    return res.status(400).json({ error: "internal must be a boolean" });
  }

  try {
    const ok = await addAdminMessage({
      ticketId: req.params.id,
      adminId: req.user!.id,
      body: text,
      isInternal: body.internal === true,
    });
    if (!ok) return res.status(404).json({ error: "Ticket not found" });
    return res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: failed to post support message");
    return res.status(500).json({ error: "Could not post the message" });
  }
});

router.patch("/support/:id", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: string; priority?: string; assigned_to?: string | null };

  if (body.status !== undefined && !ticketStatusParam(body.status)) {
    return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(", ")}` });
  }
  if (body.priority !== undefined && !ticketPriorityParam(body.priority)) {
    return res.status(400).json({ error: `priority must be one of: ${TICKET_PRIORITIES.join(", ")}` });
  }
  if (body.assigned_to !== undefined && body.assigned_to !== null && typeof body.assigned_to !== "string") {
    return res.status(400).json({ error: "assigned_to must be a user id or null" });
  }

  try {
    const ok = await updateSupportTicket({
      ticketId: req.params.id,
      adminId: req.user!.id,
      status: ticketStatusParam(body.status),
      priority: ticketPriorityParam(body.priority),
      assignedTo: body.assigned_to,
    });
    if (!ok) return res.status(404).json({ error: "Ticket not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: failed to update support ticket");
    return res.status(500).json({ error: "Could not update the ticket" });
  }
});

router.post("/support/:id/read", async (req: Request, res: Response) => {
  try {
    await markTicketReadByAdmin(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: failed to mark support ticket read");
    return res.status(500).json({ error: "Could not update the ticket" });
  }
});

// Mute is time-boxed on purpose: `until: null` lifts it, a timestamp sets it.
// An indefinite mute would silently strand a user with no way to reach us.
router.post("/support/:id/mute", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user_id?: string; until?: string | null };
  if (typeof body.user_id !== "string" || !body.user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }
  if (body.user_id === req.user!.id) {
    return res.status(400).json({ error: "You can't mute your own account" });
  }

  let until: string | null = null;
  if (body.until != null && body.until !== "") {
    const parsed = new Date(body.until);
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "until must be a valid date" });
    if (parsed.getTime() <= Date.now()) return res.status(400).json({ error: "until must be a future date" });
    until = parsed.toISOString();
  }

  try {
    const ok = await setSupportMute({ ticketId: req.params.id, userId: body.user_id, adminId: req.user!.id, until });
    if (!ok) return res.status(403).json({ error: "That account can't be muted" });
    return res.json({ ok: true, until });
  } catch (err) {
    req.log.error({ err }, "admin: failed to set support mute");
    return res.status(500).json({ error: "Could not update the mute" });
  }
});

export default router;
