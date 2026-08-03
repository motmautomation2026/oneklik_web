// Turns a free-form website value (e.g. "https://www.Acme.com/about") into a
// bare domain ("acme.com") suitable for the people-search `domains` filter.
// Returns null when the input is empty or not parseable as a URL/host.
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}
