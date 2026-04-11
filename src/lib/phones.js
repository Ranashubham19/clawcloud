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

  return `+${kept.replace(/\D/g, "")}`;
}

export function looksLikePhone(input) {
  const normalized = normalizePhone(input);
  return normalized.length >= 8;
}

export function comparablePhone(input) {
  return normalizePhone(input).replace(/^\+/, "");
}
