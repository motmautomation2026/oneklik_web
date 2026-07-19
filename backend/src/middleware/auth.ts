import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { supabaseForUser } from "../lib/supabaseUserClient.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      supabase?: ReturnType<typeof supabaseForUser>;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = data.user;
  req.supabase = supabaseForUser(token);
  next();
}
