import { config } from "../config.js";

function cleanText(value) {
  return String(value || "").trim();
}

function safeTimezone(timezone) {
  const candidate = cleanText(timezone) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function formatInTimezone(date, timezone, options) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options
  }).format(date);
}

export function currentDateTimeSnapshot(now = new Date(), timezone = config.timezone) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const safeTz = safeTimezone(timezone);

  return {
    iso: safeDate.toISOString(),
    timezone: safeTz,
    timezoneLabel:
      safeTz === "Asia/Calcutta" || safeTz === "Asia/Kolkata"
        ? "India time"
        : safeTz,
    time: formatInTimezone(safeDate, safeTz, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }),
    timeWithSeconds: formatInTimezone(safeDate, safeTz, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }),
    date: formatInTimezone(safeDate, safeTz, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }),
    compactDate: formatInTimezone(safeDate, safeTz, {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  };
}

export function currentDateTimeContextLines(now = new Date(), timezone = config.timezone) {
  const clock = currentDateTimeSnapshot(now, timezone);
  return [
    "Current date/time context:",
    `- Current local time: ${clock.time} (${clock.timezoneLabel}, ${clock.timezone})`,
    `- Current local date: ${clock.date}`,
    `- Current ISO time: ${clock.iso}`,
    "- If the user asks the current time, date, day, or today/tomorrow/yesterday relative to now, answer using this context. Do not say you cannot access the current time."
  ];
}
