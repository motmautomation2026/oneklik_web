import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export interface Profile {
  id: string;
  company: string | null;
  role: string | null;
  use_case: string | null;
  is_admin: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from("profiles")
      .select("id, company, role, use_case, is_admin")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    loadProfile(session.user.id);
  }, [session?.user?.id]);

  // `profile` lags one async round-trip behind `session` on every sign-in —
  // a consumer that only checked a `loading` flag tied to the initial
  // session restore (the old behavior) would see loading=false with a
  // still-null profile during that gap. RequireAdmin hit exactly this: it
  // read profile=null before the fetch resolved and bounced to /dashboard.
  // Deriving readiness from whether `profile` actually matches the current
  // session's user — rather than a second loading flag — closes the gap
  // without depending on effect-ordering timing.
  const profileReady = !session?.user || profile?.id === session.user.id;

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile: profileReady ? profile : null,
    loading: sessionLoading || !profileReady,
    refreshProfile: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
