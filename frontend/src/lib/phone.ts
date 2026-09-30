// Indian mobile numbers only for now. Accepts what people actually type
// ("98765 43210", "+91-98765-43210", "09876543210") and returns E.164
// ("+919876543210"), or null if it isn't a valid Indian mobile. The DB check
// constraint (0024) only enforces generic E.164, so widening to other
// countries later is a frontend-only change.
export function normalizeIndianMobile(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

// "+919876543210" -> "+91 98765 43210"; anything else is returned unchanged.
export function formatPhone(phone: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return match ? `+91 ${match[1]} ${match[2]}` : phone;
}

// The bare 10-digit part, for pre-filling the input next to a fixed +91 prefix.
export function localIndianDigits(phone: string | null | undefined): string {
  return phone?.startsWith("+91") ? phone.slice(3) : "";
}
