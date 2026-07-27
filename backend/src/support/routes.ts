import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  countUnreadTickets,
  createTicket,
  getAttachmentUrl,
  getTicketDetail,
  listTickets,
  markTicketRead,
  replyToTicket,
  sweepOrphanAttachments,
} from "./queries.js";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  TICKET_CATEGORIES,
  type TicketCategory,
  type TicketSource,
} from "./types.js";

const router = Router();

// requireAuth ONLY — enforceAccountStatus is deliberately absent.
//
// Do not add it. Every other product router chains it, but a frozen,
// suspended, or banned user must be able to reach support: appealing the
// restriction is the entire reason this feature exists. Gating these routes
// would return 403 to precisely the people who most need to talk to us.
// Support joins the webhook and /api/admin routers in the never-gated bucket.
//
// The restriction is still enforced everywhere it matters — these routes touch
// no credits, no wallet, and no product data. The only thing an account-status
// check would buy here is silence from users we have restricted.
router.use(requireAuth);

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

// Body text is stored and rendered verbatim as plain text (React escapes on
// output; nothing renders it as HTML). Control characters other than newline
// and tab are stripped so a thread can't be visually corrupted.
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Strips C0/C1 control characters, preserving tab (9), newline (10) and
  // carriage return (13) — the three a multi-line message legitimately
  // contains. Written as codepoint comparisons rather than a regex escape
  // class because literal control characters in source are invisible, and
  // an escaped class is one careless reformat away from becoming literal.
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) {
      out += ch;
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    out += ch;
  }
  return out.trim();
}

function attachmentPaths(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 512)) return null;
  return value as string[];
}

const TICKET_SOURCES: TicketSource[] = ["app", "lockout"];

router.post("/tickets", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const category = typeof body.category === "string" ? body.category : "";
  if (!(TICKET_CATEGORIES as string[]).includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${TICKET_CATEGORIES.join(", ")}` });
  }

  const subject = cleanText(body.subject);
  if (!subject) return res.status(400).json({ error: "A subject is required" });
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return res.status(400).json({ error: `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer` });
  }

  const message = cleanText(body.body);
  if (!message) return res.status(400).json({ error: "A message is required" });
  if (message.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_BODY_LENGTH} characters or fewer` });
  }

  const paths = attachmentPaths(body.attachment_paths);
  if (paths === null) return res.status(400).json({ error: "attachment_paths must be an array of strings" });

  const source = (TICKET_SOURCES as string[]).includes(String(body.source)) ? (body.source as TicketSource) : "app";

  const contextRefType =
    body.context_ref_type === "run" || body.context_ref_type === "list" || body.context_ref_type === "payment"
      ? body.context_ref_type
      : null;
  const contextRefId = contextRefType && typeof body.context_ref_id === "string" ? body.context_ref_id : null;

  try {
    const result = await createTicket({
      userId,
      category: category as TicketCategory,
      subject,
      body: message,
      source,
      attachmentPaths: paths,
      // Both or neither — the DB has a CHECK constraint enforcing the same.
      contextRefType: contextRefId ? contextRefType : null,
      contextRefId,
      relatedTicketId: typeof body.related_ticket_id === "string" ? body.related_ticket_id : null,
    });

    if (!result.ok) return respondToFailure(res, result);

    // Fire-and-forget: reclaiming abandoned uploads must never delay or fail
    // the user's submission.
    void sweepOrphanAttachments(userId).catch((err) =>
      req.log.warn({ err }, "support: orphan attachment sweep failed"),
    );

    return res.status(201).json({ ticket: result.ticket, appended: result.appended });
  } catch (err) {
    req.log.error({ err }, "support: failed to create ticket");
    return res.status(500).json({ error: "Could not create your ticket" });
  }
});

router.get("/tickets", async (req: Request, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 100_000);
  const pageSize = clampInt(req.query.pageSize, 20, 1, 50);
  try {
    return res.json(await listTickets(req.user!.id, { page, pageSize }));
  } catch (err) {
    req.log.error({ err }, "support: failed to list tickets");
    return res.status(500).json({ error: "Could not load your tickets" });
  }
});

// Registered before /tickets/:id — otherwise "unread-count" is swallowed as an
// :id param. Same ordering hazard already noted for /users/kpis in admin.
router.get("/tickets/unread-count", async (req: Request, res: Response) => {
  try {
    return res.json({ unread: await countUnreadTickets(req.user!.id) });
  } catch (err) {
    req.log.error({ err }, "support: failed to count unread tickets");
    return res.status(500).json({ error: "Could not load unread count" });
  }
});

router.get("/tickets/:id", async (req: Request, res: Response) => {
  try {
    const ticket = await getTicketDetail(req.params.id, { userId: req.user!.id, isAdmin: false });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    return res.json({ ticket });
  } catch (err) {
    req.log.error({ err }, "support: failed to load ticket");
    return res.status(500).json({ error: "Could not load the ticket" });
  }
});

router.post("/tickets/:id/messages", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const message = cleanText(body.body);
  if (!message) return res.status(400).json({ error: "A message is required" });
  if (message.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Message must be ${MAX_BODY_LENGTH} characters or fewer` });
  }

  const paths = attachmentPaths(body.attachment_paths);
  if (paths === null) return res.status(400).json({ error: "attachment_paths must be an array of strings" });

  try {
    const result = await replyToTicket({ userId, ticketId: req.params.id, body: message, attachmentPaths: paths });

    if (!result.ok) {
      if (result.reason === "not_found") return res.status(404).json({ error: "Ticket not found" });
      if (result.reason === "closed") {
        return res.status(409).json({
          error: "This ticket is closed. Please raise a new one and we'll link it to this conversation.",
          reason: "closed",
        });
      }
      return respondToFailure(res, result);
    }

    void sweepOrphanAttachments(userId).catch((err) =>
      req.log.warn({ err }, "support: orphan attachment sweep failed"),
    );

    return res.status(201).json({ ticket: result.ticket, reopened: result.reopened });
  } catch (err) {
    req.log.error({ err }, "support: failed to post reply");
    return res.status(500).json({ error: "Could not send your reply" });
  }
});

router.post("/tickets/:id/read", async (req: Request, res: Response) => {
  try {
    await markTicketRead(req.params.id, req.user!.id);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "support: failed to mark ticket read");
    return res.status(500).json({ error: "Could not update the ticket" });
  }
});

router.get("/attachments/:id/url", async (req: Request, res: Response) => {
  try {
    const url = await getAttachmentUrl(req.params.id, { userId: req.user!.id, isAdmin: false });
    if (!url) return res.status(404).json({ error: "Attachment not found" });
    return res.json({ url });
  } catch (err) {
    req.log.error({ err }, "support: failed to sign attachment url");
    return res.status(500).json({ error: "Could not open the attachment" });
  }
});

// Shared mapping for the failure shapes createTicket and replyToTicket have in
// common, so the two routes can't drift into reporting the same condition with
// different status codes.
function respondToFailure(
  res: Response,
  result: { reason: string; until?: string | null; retry_after_seconds?: number; detail?: string },
): Response {
  if (result.reason === "muted") {
    return res.status(403).json({
      error: "New support messages from this account are paused. Please contact us through another channel.",
      reason: "muted",
      until: result.until ?? null,
    });
  }
  if (result.reason === "rate_limited") {
    const retryAfter = result.retry_after_seconds ?? 60;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: `You're sending messages a little too quickly. Try again in ${retryAfter} seconds.`,
      reason: "rate_limited",
      retry_after_seconds: retryAfter,
    });
  }
  if (result.reason === "invalid_attachment") {
    return res.status(400).json({ error: result.detail ?? "That attachment could not be used", reason: "invalid_attachment" });
  }
  return res.status(400).json({ error: "Could not process the request" });
}

export default router;
