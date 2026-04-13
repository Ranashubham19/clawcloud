export function normalizePhone(input) {
  if (!input) {
    return "";
  }

  const trimmed = String(input).trim();
  const kept = trimmed.replace(/[^\d+]/g, "");
  if (!kept) {
    return "";
  }

  if (kept.startsWith("+")) {
    return `+${kept.slice(1).replace(/\D/g, "")}`;
  }

  if (kept.startsWith("00")) {
    return `+${kept.slice(2).replace(/\D/g, "")}`;
  }

  const digits = kept.replace(/\D/g, "");

  // 10-digit number starting with 6-9 → Indian mobile number (+91)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }

  // 11-digit number starting with 0 → Indian number with leading 0 (0XXXXXXXXXX → +91XXXXXXXXXX)
  if (digits.length === 11 && digits.startsWith("0") && /^0[6-9]/.test(digits)) {
    return `+91${digits.slice(1)}`;
  }

  return `+${digits}`;
}

export function looksLikePhone(input) {
  const normalized = normalizePhone(input);
  return normalized.length >= 8;
}

export function comparablePhone(input) {
  return normalizePhone(input).replace(/^\+/, "");
}
