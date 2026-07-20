import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

interface SuggestionTypeConfig {
  searchField: string;
  responseKey: string;
  // Prospeo's response shape differs per type — industry_suggestions is a
  // plain string[], location_suggestions is [{name, type}] — normalize
  // both down to string[] here so the frontend contract stays uniform.
  mapToStrings: (raw: unknown) => string[];
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function asNameArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string"
      ? (item as { name: string }).name
      : null))
    .filter((v): v is string => v !== null);
}

// Extending this to technology/etc. later is just adding an entry here.
const SUGGESTION_TYPES: Record<string, SuggestionTypeConfig> = {
  industry: { searchField: "industry_search", responseKey: "industry_suggestions", mapToStrings: asStringArray },
  location: { searchField: "location_search", responseKey: "location_suggestions", mapToStrings: asNameArray },
  job_title: { searchField: "job_title_search", responseKey: "job_title_suggestions", mapToStrings: asStringArray },
};

router.post("/prospeo/suggestions", requireAuth, async (req: Request, res: Response) => {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "PROSPEO_API_KEY not configured" });
  }

  const body = (req.body ?? {}) as { query?: string; type?: string };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const config = body.type ? SUGGESTION_TYPES[body.type] : undefined;

  if (!config) {
    return res.status(400).json({ error: "Unsupported suggestion type" });
  }

  // Prospeo requires 2+ chars — just return empty rather than call it.
  if (query.length < 2) {
    return res.json({ suggestions: [] });
  }

  try {
    const prospeoRes = await fetch("https://api.prospeo.io/search-suggestions", {
      method: "POST",
      headers: { "X-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ [config.searchField]: query }),
    });

    if (!prospeoRes.ok) {
      req.log.error({ status: prospeoRes.status }, "prospeo suggestions request failed");
      return res.json({ suggestions: [] });
    }

    const data = (await prospeoRes.json()) as { error?: boolean } & Record<string, unknown>;
    const suggestions = data.error ? [] : config.mapToStrings(data[config.responseKey]);
    return res.json({ suggestions });
  } catch (err) {
    req.log.error({ err }, "prospeo suggestions call failed");
    // Autocomplete is a UX aid, not critical path — fail soft, not loud.
    return res.json({ suggestions: [] });
  }
});

export default router;
