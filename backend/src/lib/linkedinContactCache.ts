// Short-lived, per-user, in-memory cache for contact info the free LinkedIn
// lookup already paid SalesQL to fetch as a byproduct (see linkedinLookup.ts).
// Deliberately NOT a database table: it must never be durable, never shared
// across users, and never survive long — a process restart or the TTL below
// wipes it, which is exactly the point. This only ever saves a redundant
// provider call on a cache hit; a miss (cold cache, different backend
// instance, expired entry) just falls back to the normal paid waterfall in
// n8n, so there is no correctness dependency on this cache being warm.
const TTL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;

interface CacheEntry {
  workEmail: string;
  phone: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function normalizeLinkedinUrl(linkedinUrl: string): string {
  return linkedinUrl.trim().replace(/\/+$/, "").toLowerCase();
}

function cacheKey(userId: string, linkedinUrl: string): string {
  return `${userId}::${normalizeLinkedinUrl(linkedinUrl)}`;
}

export function setLinkedinContactCache(
  userId: string,
  linkedinUrl: string,
  contact: { workEmail?: string; phone?: string },
): void {
  const workEmail = contact.workEmail?.trim() ?? "";
  const phone = contact.phone?.trim() ?? "";
  if (!workEmail && !phone) return;
  if (!userId || !linkedinUrl.trim()) return;

  cache.set(cacheKey(userId, linkedinUrl), {
    workEmail,
    phone,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function getLinkedinContactCache(
  userId: string,
  linkedinUrl: string,
): { workEmail: string; phone: string } | null {
  if (!userId || !linkedinUrl.trim()) return null;

  const key = cacheKey(userId, linkedinUrl);
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return { workEmail: entry.workEmail, phone: entry.phone };
}

// Bounds memory growth from entries nobody ever reveals — otherwise every
// free lookup with a byproduct email/phone would sit in the map until the
// process restarts, even long past its TTL.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();
