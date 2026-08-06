// Second-level public suffixes where the registrable domain is the last
// THREE labels, not two (e.g. "company.co.in", not just "co.in"). Not an
// exhaustive public-suffix list — covers the common ones; anything else
// falls back to the standard last-two-labels rule.
const TWO_PART_SUFFIXES = new Set([
  "co.in",
  "co.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.za",
  "co.id",
  "com.au",
  "com.br",
  "com.cn",
  "com.sg",
  "com.mx",
  "com.tr",
  "net.in",
  "org.in",
  "gov.in",
  "ac.in",
  "ne.jp",
  "or.jp",
]);

// Turns a free-form website value (e.g. "https://parry.murugappa.com/about")
// into a bare registrable domain ("murugappa.com") suitable for the
// people-search `domains` filter — collapsing any subdomain too, since the
// data provider behind that search rejects subdomains outright ("Subdomains
// are not supported: ..."). Returns "" when the input is empty or not
// parseable as a URL/host.
export function normalizeDomain(website: string | null | undefined): string {
  if (!website) return "";
  const trimmed = website.trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host) return "";

  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  if (TWO_PART_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}
