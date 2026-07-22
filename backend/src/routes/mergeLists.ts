import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

// Natural dedupe key per list kind — same company/person appearing in more
// than one source list collapses to one row in the merged list.
function dedupeKey(kind: "company" | "people", data: Record<string, unknown>): string {
  const raw =
    kind === "company"
      ? data.Website || data.Company
      : data["USER SOCIAL"] || data.Email || data["FULL NAME"];
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

router.post("/lists/merge", requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { list_ids?: string[]; name?: string };
  const listIds = Array.isArray(body.list_ids) ? [...new Set(body.list_ids.filter(Boolean))] : [];

  if (listIds.length < 2) {
    return res.status(400).json({ error: "Select at least two lists to merge" });
  }

  const userId = req.user!.id;

  const { data: lists, error: listsError } = await supabaseAdmin
    .from("lists")
    .select("id, kind")
    .in("id", listIds)
    .eq("user_id", userId);

  if (listsError || !lists || lists.length !== listIds.length) {
    return res.status(404).json({ error: "Could not find all selected lists" });
  }

  const kinds = new Set(lists.map((l) => l.kind));
  if (kinds.size > 1) {
    return res.status(400).json({ error: "Can only merge lists of the same type (company or people)" });
  }
  const kind = lists[0].kind as "company" | "people";

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("list_items")
    .select("data")
    .in("list_id", listIds)
    .eq("user_id", userId);

  if (itemsError) {
    req.log.error({ err: itemsError }, "failed to read rows for list merge");
    return res.status(500).json({ error: "Could not read list rows" });
  }

  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const item of items ?? []) {
    const data = item.data as Record<string, unknown>;
    const key = dedupeKey(kind, data);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    deduped.push(data);
  }

  const mergedName =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : `Merged List — ${new Date().toISOString().slice(0, 10)}`;

  const { data: newList, error: newListError } = await supabaseAdmin
    .from("lists")
    .insert({ user_id: userId, name: mergedName, kind })
    .select("id")
    .single();

  if (newListError || !newList) {
    req.log.error({ err: newListError }, "failed to create merged list");
    return res.status(500).json({ error: "Could not create merged list" });
  }

  const { error: insertError } = await supabaseAdmin
    .from("list_items")
    .insert(deduped.map((data) => ({ list_id: newList.id, user_id: userId, data })));

  if (insertError) {
    req.log.error({ err: insertError }, "failed to populate merged list");
    return res.status(500).json({ error: "Could not populate merged list" });
  }

  return res.json({ list_id: newList.id, row_count: deduped.length, source_row_count: items?.length ?? 0 });
});

export default router;
