export interface Company {
  Company: string;
  Website: string;
  Location: string;
  Industry: string;
  Headcount: string;
  Phone: string;
  LinkedIn: string;
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Shared by manual Company Search and AI Company Search — both receive rows
// from n8n in this same loose shape.
export function normalizeCompany(row: Record<string, unknown>): Company {
  return {
    Company: pick(row, "Company", "COMPANY", "company"),
    Website: pick(row, "Website", "WEBSITE", "website"),
    Location: pick(row, "Location", "LOCATION", "location"),
    Industry: pick(row, "Industry", "INDUSTRY", "industry"),
    Headcount: pick(row, "Headcount", "HEADCOUNT", "headcount"),
    Phone: pick(row, "Phone", "PHONE", "phone"),
    LinkedIn: pick(row, "LinkedIn", "LINKEDIN", "linkedin"),
  };
}

export function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj?.companies)) return obj.companies as unknown[];
  if (Array.isArray(obj?.data)) return obj.data as unknown[];
  return [];
}
