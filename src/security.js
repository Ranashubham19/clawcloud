import crypto from "node:crypto";
import { config } from "./config.js";

const rateBuckets = new Map();

function cleanText(value) {
  return String(value || "").trim();
}

function rateBucketKey(bucket, identifier) {
  return `${bucket}:${identifier}`;
}

function nowMs() {
  return Date.now();
}

export function getClientIp(request) {
  const forwarded = cleanText(request.headers["x-forwarded-for"] || "");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return cleanText(request.socket?.remoteAddress || "unknown");
}

export function requestOrigin(request) {
  const forwardedProto = cleanText(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = cleanText(request.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || (request.socket?.encrypted ? "https" : "http");
  const host = forwardedHost || cleanText(request.headers.host || "localhost");
  return `${protocol}://${host}`;
}

export function isSecureRequest(request) {
  if (config.appCookieSecure === "true") {
    return true;
  }
  if (config.appCookieSecure === "false") {
    return false;
  }
  return requestOrigin(request).startsWith("https://");
}

export function defaultSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' https://checkout.razorpay.com https://js.stripe.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; img-src 'self' data: https://*.razorpay.com; font-src 'self'; frame-src https://api.razorpay.com https://js.stripe.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
}

function trustedOrigins(request) {
  const allowed = new Set([requestOrigin(request)]);
  if (config.appBaseUrl) {
    allowed.add(String(config.appBaseUrl).replace(/\/$/, ""));
  }
  return allowed;
}

export function hasTrustedOrigin(request) {
  const candidateHeaders = [
    cleanText(request.headers.origin || ""),
    cleanText(request.headers.referer || "")
  ].filter(Boolean);

  if (!candidateHeaders.length) {
    return true;
  }

  const allowed = trustedOrigins(request);
  return candidateHeaders.every((entry) => {
    try {
      const normalized = new URL(entry).origin;
      return allowed.has(normalized);
    } catch {
      return false;
    }
  });
}

export function consumeRateLimit({
  bucket,
  identifier,
  limit,
  windowMs
}) {
  const key = rateBucketKey(bucket, identifier);
  const currentTime = nowMs();
  const entry = rateBuckets.get(key);

  if (!entry || entry.resetAt <= currentTime) {
    rateBuckets.set(key, {
      count: 1,
      resetAt: currentTime + windowMs
    });
    return {
      ok: true,
      remaining: Math.max(limit - 1, 0),
      resetAt: currentTime + windowMs
    };
  }

  if (entry.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: entry.resetAt
    };
  }

  entry.count += 1;
  rateBuckets.set(key, entry);
  return {
    ok: true,
    remaining: Math.max(limit - entry.count, 0),
    resetAt: entry.resetAt
  };
}

export function authRateLimit(request) {
  return consumeRateLimit({
    bucket: "auth",
    identifier: getClientIp(request),
    limit: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs
  });
}

export function writeRateLimit(request, scope = "write") {
  return consumeRateLimit({
    bucket: `write:${scope}`,
    identifier: getClientIp(request),
    limit: config.writeRateLimitMax,
    windowMs: config.writeRateLimitWindowMs
  });
}

export function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const header = cleanText(signatureHeader);
  const endpointSecret = cleanText(secret);
  if (!header || !endpointSecret || !rawBody?.length) {
    return false;
  }

  const pieces = header.split(",").reduce((accumulator, segment) => {
    const [key, value] = segment.split("=");
    if (key && value) {
      accumulator[key.trim()] = value.trim();
    }
    return accumulator;
  }, {});

  if (!pieces.t || !pieces.v1) {
    return false;
  }

  const signedPayload = `${pieces.t}.${rawBody.toString("utf8")}`;
  const digest = crypto
    .createHmac("sha256", endpointSecret)
    .update(signedPayload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(pieces.v1));
  } catch {
    return false;
  }
}
