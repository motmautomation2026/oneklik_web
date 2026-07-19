import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
}

// Creates a client scoped to the requesting user's access token, so every
// query runs through Postgres RLS instead of relying on app-code checks.
export function supabaseForUser(accessToken: string) {
  return createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
