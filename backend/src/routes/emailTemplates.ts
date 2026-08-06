import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { ensureSubscriptionCreditState } from "../lib/ensureSubscription.js";

const router = Router();

const FREE_LIMIT = 20;
const ALLOWED_ATTACHMENT_MIMES = new Set(["application/pdf"]);
const MAX_ATTACHMENT_BYTES = 5_242_880;
const BUCKET = "email-template-uploads";
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 900;
const LENGTHS = new Set(["short", "standard", "detailed"]);
const TONES = new Set(["professional", "casual"]);

type BrochureInput = {
  storage_path?: string;
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
};

type UsagePayload = {
  free_limit: number;
  free_used: number;
  free_remaining: number;
  subscription_period_id: string | null;
  period_start: string | null;
  period_end: string | null;
  has_active_period: boolean;
};

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLengthTone(body: { length?: unknown; tone?: unknown }): {
  length: string;
  tone: string;
  error?: string;
} {
  const lengthRaw = trimOrEmpty(body.length) || "standard";
  const toneRaw = trimOrEmpty(body.tone) || "professional";
  if (!LENGTHS.has(lengthRaw)) {
    return { length: lengthRaw, tone: toneRaw, error: "length must be short, standard, or detailed" };
  }
  if (!TONES.has(toneRaw)) {
    return { length: lengthRaw, tone: toneRaw, error: "tone must be professional or casual" };
  }
  return { length: lengthRaw, tone: toneRaw };
}

function parseSubjectBody(data: unknown): { subject: string; body: string } | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Empty response from email template provider" };
  }
  const row = data as { subject?: unknown; body?: unknown };
  const subject = typeof row.subject === "string" ? row.subject.trim() : "";
  const bodyText = typeof row.body === "string" ? row.body.trim() : "";
  if (!subject || !bodyText) {
    return { error: "Provider returned incomplete subject or body" };
  }
  return { subject, body: bodyText };
}

async function loadUsage(userId: string): Promise<UsagePayload> {
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("status, current_period_id, current_period_start, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  const eligible =
    !!sub &&
    (sub.status === "active" || sub.status === "past_due") &&
    !!sub.current_period_id;

  if (!eligible || !sub?.current_period_id) {
    return {
      free_limit: FREE_LIMIT,
      free_used: 0,
      free_remaining: 0,
      subscription_period_id: null,
      period_start: null,
      period_end: null,
      has_active_period: false,
    };
  }

  const { data: usage } = await supabaseAdmin
    .from("email_template_period_usage")
    .select("free_used")
    .eq("subscription_period_id", sub.current_period_id)
    .maybeSingle();

  const freeUsed = usage?.free_used ?? 0;

  return {
    free_limit: FREE_LIMIT,
    free_used: freeUsed,
    free_remaining: Math.max(0, FREE_LIMIT - freeUsed),
    subscription_period_id: sub.current_period_id as string,
    period_start: (sub.current_period_start as string) ?? null,
    period_end: (sub.current_period_end as string) ?? null,
    has_active_period: true,
  };
}

router.get(
  "/email-templates/usage",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const usage = await loadUsage(req.user!.id);
    return res.json(usage);
  },
);

router.get(
  "/email-templates",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabaseAdmin
      .from("email_template_generations")
      .select(
        "id, user_request, company_profile, company_website, subject, status, billing_type, credits_charged, created_at, completed_at",
        { count: "exact" },
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      req.log.error({ err: error }, "failed to list email template generations");
      return res.status(500).json({ error: "Could not load generation history" });
    }

    return res.json({
      items: data ?? [],
      page,
      pageSize,
      total: count ?? 0,
    });
  },
);

router.get(
  "/email-templates/:id",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = req.params.id;

    const { data: generation, error } = await supabaseAdmin
      .from("email_template_generations")
      .select(
        "id, user_request, company_profile, company_website, subject, body, status, billing_type, credits_charged, error_message, created_at, completed_at",
      )
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      req.log.error({ err: error }, "failed to load email template generation");
      return res.status(500).json({ error: "Could not load generation" });
    }
    if (!generation) {
      return res.status(404).json({ error: "Generation not found" });
    }

    const { data: attachments } = await supabaseAdmin
      .from("email_template_attachments")
      .select("id, kind, filename, mime_type, size_bytes, created_at")
      .eq("generation_id", id)
      .eq("user_id", userId);

    return res.json({ generation, attachments: attachments ?? [] });
  },
);

router.patch(
  "/email-templates/:id",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = req.params.id;
    const body = (req.body ?? {}) as { subject?: unknown; body?: unknown };

    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const emailBody = typeof body.body === "string" ? body.body.trim() : "";

    if (!subject || !emailBody) {
      return res.status(400).json({ error: "Subject and body are required" });
    }
    if (subject.length > 300) {
      return res.status(400).json({ error: "Subject must be 300 characters or fewer" });
    }

    const { data: existing, error: loadError } = await supabaseAdmin
      .from("email_template_generations")
      .select("id, status")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (loadError) {
      req.log.error({ err: loadError }, "failed to load generation for edit");
      return res.status(500).json({ error: "Could not update generation" });
    }
    if (!existing) {
      return res.status(404).json({ error: "Generation not found" });
    }
    if (existing.status !== "completed") {
      return res.status(400).json({ error: "Only completed generations can be edited" });
    }

    const { data: generation, error: updateError } = await supabaseAdmin
      .from("email_template_generations")
      .update({ subject, body: emailBody })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "completed")
      .select(
        "id, user_request, company_profile, company_website, subject, body, status, billing_type, credits_charged, error_message, created_at, completed_at",
      )
      .single();

    if (updateError || !generation) {
      req.log.error({ err: updateError }, "failed to update email template generation");
      return res.status(500).json({ error: "Could not save edits" });
    }

    return res.json({ generation });
  },
);

router.post(
  "/email-templates/rewrite",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const webhookUrl = process.env["email_template_generator_webhook"];
    if (!webhookUrl) {
      return res.status(500).json({ error: "email_template_generator_webhook not configured" });
    }

    const body = (req.body ?? {}) as {
      subject?: unknown;
      body?: unknown;
      length?: unknown;
      tone?: unknown;
      instruction?: unknown;
    };

    const subjectIn = trimOrEmpty(body.subject);
    const bodyIn = trimOrEmpty(body.body);
    if (!subjectIn || !bodyIn) {
      return res.status(400).json({ error: "Subject and body are required" });
    }

    const instruction = trimOrEmpty(body.instruction);
    if (instruction.length > 2000) {
      return res.status(400).json({ error: "instruction must be 2000 characters or fewer" });
    }

    const style = parseLengthTone(body);
    if (style.error) {
      return res.status(400).json({ error: style.error });
    }

    try {
      const n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "rewrite",
          subject: subjectIn,
          body: bodyIn,
          length: style.length,
          tone: style.tone,
          instruction,
        }),
      });

      if (!n8nRes.ok) {
        const bodySnippet = await n8nRes.text().catch(() => "");
        req.log.error(
          { status: n8nRes.status, body: bodySnippet },
          "email-template rewrite webhook returned non-2xx",
        );
        return res.status(502).json({ error: "Email rewrite provider failed" });
      }

      const bodySnippet = await n8nRes.text();
      const data: unknown = bodySnippet.trim() ? JSON.parse(bodySnippet) : null;
      const parsed = parseSubjectBody(data);
      if ("error" in parsed) {
        return res.status(502).json({ error: parsed.error });
      }

      return res.json({ subject: parsed.subject, body: parsed.body });
    } catch (err) {
      req.log.error({ err }, "email-template rewrite webhook call failed");
      return res.status(502).json({ error: "Email rewrite provider failed" });
    }
  },
);

router.post(
  "/email-templates/generate",
  requireAuth,
  enforceAccountStatus(),
  async (req: Request, res: Response) => {
    const webhookUrl = process.env["email_template_generator_webhook"];
    if (!webhookUrl) {
      return res.status(500).json({ error: "email_template_generator_webhook not configured" });
    }

    const body = (req.body ?? {}) as {
      user_request?: unknown;
      company_profile?: unknown;
      company_website?: unknown;
      brochure?: BrochureInput;
      length?: unknown;
      tone?: unknown;
    };

    const userRequest = trimOrEmpty(body.user_request);
    const companyProfile = trimOrEmpty(body.company_profile);
    const companyWebsite = trimOrEmpty(body.company_website);
    const brochure = body.brochure;
    const style = parseLengthTone(body);
    if (style.error) {
      return res.status(400).json({ error: style.error });
    }

    if (!companyProfile && !companyWebsite && !userRequest) {
      return res.status(400).json({
        error: "Provide a company profile, website, or describe what you want",
      });
    }

    const userId = req.user!.id;
    await ensureSubscriptionCreditState(userId, req.log);

    const { data: generation, error: insertError } = await supabaseAdmin
      .from("email_template_generations")
      .insert({
        user_id: userId,
        status: "pending",
        user_request: userRequest || null,
        company_profile: companyProfile || null,
        company_website: companyWebsite || null,
      })
      .select("id")
      .single();

    if (insertError || !generation) {
      req.log.error({ err: insertError }, "failed to create email template generation");
      return res.status(500).json({ error: "Could not start generation" });
    }

    const generationId = generation.id as string;

    if (brochure?.storage_path) {
      const path = trimOrEmpty(brochure.storage_path);
      const filename = trimOrEmpty(brochure.filename) || "attachment.pdf";
      const mime = trimOrEmpty(brochure.mime_type);
      const sizeBytes = Number(brochure.size_bytes);

      if (!path.startsWith(`${userId}/`)) {
        await markGenerationFailedLocal(generationId, "Invalid attachment path");
        return res.status(400).json({ error: "Invalid attachment path" });
      }
      if (!ALLOWED_ATTACHMENT_MIMES.has(mime)) {
        await markGenerationFailedLocal(generationId, "Unsupported attachment type");
        return res.status(400).json({ error: "Attachment must be a PDF" });
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_ATTACHMENT_BYTES) {
        await markGenerationFailedLocal(generationId, "Invalid attachment size");
        return res.status(400).json({ error: "Attachment must be 5 MB or smaller" });
      }

      const { error: attError } = await supabaseAdmin.from("email_template_attachments").insert({
        generation_id: generationId,
        user_id: userId,
        kind: "brochure",
        storage_path: path,
        filename: filename.slice(0, 255),
        mime_type: mime,
        size_bytes: sizeBytes,
      });

      if (attError) {
        req.log.error({ err: attError }, "failed to record email template attachment");
        await markGenerationFailedLocal(generationId, "Could not save attachment");
        return res.status(500).json({ error: "Could not save attachment" });
      }
    }

    const { data: reserveData, error: reserveError } = await supabaseAdmin.rpc(
      "fn_reserve_email_template_generation",
      {
        p_user_id: userId,
        p_generation_id: generationId,
      },
    );

    if (reserveError) {
      req.log.error({ err: reserveError }, "failed to reserve email template generation");
      await markGenerationFailedLocal(generationId, reserveError.message);

      const insufficient = reserveError.message?.includes("insufficient_credits");
      return res.status(insufficient ? 402 : 500).json({
        error: insufficient
          ? "Not enough credits for this generation"
          : "Could not reserve generation",
      });
    }

    const billingType =
      reserveData && typeof reserveData === "object" && "billing_type" in reserveData
        ? String((reserveData as { billing_type: string }).billing_type)
        : "credit";

    let brochurePayload:
      | { url: string; filename: string; mime_type: string }
      | undefined;

    if (brochure?.storage_path) {
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(brochure.storage_path, ATTACHMENT_SIGNED_URL_TTL_SECONDS);

      if (signError || !signed?.signedUrl) {
        req.log.error({ err: signError }, "failed to sign attachment URL");
        await finalizeGeneration(req, generationId, "failed", null, null, "Could not access attachment");
        return res.status(500).json({ error: "Could not access attachment" });
      }

      brochurePayload = {
        url: signed.signedUrl,
        filename: trimOrEmpty(brochure.filename) || "attachment.pdf",
        mime_type: trimOrEmpty(brochure.mime_type),
      };
    }

    let subject = "";
    let bodyText = "";
    let n8nFailed = false;
    let failReason = "Email template provider failed";

    try {
      const n8nRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate",
          generation_id: generationId,
          user_request: userRequest,
          company_profile: companyProfile,
          company_website: companyWebsite,
          length: style.length,
          tone: style.tone,
          ...(brochurePayload ? { brochure: brochurePayload } : {}),
        }),
      });

      if (!n8nRes.ok) {
        const bodySnippet = await n8nRes.text().catch(() => "");
        req.log.error(
          { status: n8nRes.status, body: bodySnippet },
          "email-template webhook returned non-2xx",
        );
        n8nFailed = true;
      } else {
        const bodySnippet = await n8nRes.text();
        const data: unknown = bodySnippet.trim() ? JSON.parse(bodySnippet) : null;
        const parsed = parseSubjectBody(data);
        if ("error" in parsed) {
          n8nFailed = true;
          failReason = parsed.error;
        } else {
          subject = parsed.subject;
          bodyText = parsed.body;
        }
      }
    } catch (err) {
      req.log.error({ err }, "email-template webhook call failed");
      n8nFailed = true;
    }

    if (n8nFailed) {
      await finalizeGeneration(req, generationId, "failed", null, null, failReason);
      const usage = await loadUsage(userId);
      return res.status(502).json({
        error:
          billingType === "credit"
            ? "Email template provider failed, credits released"
            : "Email template provider failed, free quota restored",
        usage,
      });
    }

    await finalizeGeneration(req, generationId, "completed", subject, bodyText, null);
    const usage = await loadUsage(userId);

    return res.json({
      id: generationId,
      subject,
      body: bodyText,
      billing_type: billingType,
      usage,
    });
  },
);

async function markGenerationFailedLocal(generationId: string, message: string): Promise<void> {
  await supabaseAdmin
    .from("email_template_generations")
    .update({
      status: "failed",
      error_message: message,
      completed_at: new Date().toISOString(),
    })
    .eq("id", generationId)
    .eq("status", "pending");
}

async function finalizeGeneration(
  req: Request,
  generationId: string,
  outcome: "completed" | "failed",
  subject: string | null,
  body: string | null,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("fn_finalize_email_template_generation", {
    p_generation_id: generationId,
    p_outcome: outcome,
    p_subject: subject,
    p_body: body,
    p_error: errorMessage,
  });
  if (error) {
    req.log.error({ err: error, generationId }, "fn_finalize_email_template_generation failed");
  }
}

export default router;
