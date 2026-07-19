import type { AuthError } from "@supabase/supabase-js";

// supabase-js classifies any 5xx as "retryable" and doesn't surface the
// server's actual message on that error class — showing it raw renders as
// an unhelpful "{}". Fall back to a generic message for those; 4xx errors
// (bad password, duplicate email, etc.) carry a real message worth showing.
export function authErrorMessage(error: AuthError): string {
  if (error.status && error.status >= 500) {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  return error.message || "Something went wrong. Please try again.";
}
