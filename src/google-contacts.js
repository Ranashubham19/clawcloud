import crypto from "node:crypto";
import { config, requireConfig } from "./config.js";
import {
  getGoogleContactsIntegration,
  updateGoogleContactsIntegration,
  upsertContact
} from "./store.js";
import { normalizePhone } from "./lib/phones.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CONNECTIONS_URL =
  "https://people.googleapis.com/v1/people/me/connections";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function expiryDateFromSeconds(expiresIn) {
  const seconds = Number(expiresIn) || 0;
  if (!seconds) {
    return null;
  }
  return Date.now() + seconds * 1000;
}

function findPrimary(items = []) {
  return items.find((item) => item?.metadata?.primary) || items[0] || null;
}

function getScopeList() {
  return String(config.googleContactsScope || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getGoogleContactsRedirectUri(origin = "") {
  if (config.googleRedirectUri) {
    return config.googleRedirectUri;
  }

  const baseUrl = origin || config.appBaseUrl;
  if (!baseUrl) {
    throw new Error(
      "Missing Google redirect base URL. Set APP_BASE_URL or GOOGLE_REDIRECT_URI."
    );
  }

  return `${String(baseUrl).replace(/\/$/, "")}/integrations/google/callback`;
}

function googleConfigChecks(origin = "") {
  let redirectUri = "";
  try {
    redirectUri = getGoogleContactsRedirectUri(origin);
  } catch {
    redirectUri = "";
  }

  return {
    admin_api_token: Boolean(config.adminApiToken),
    google_client_id: Boolean(config.googleClientId),
    google_client_secret: Boolean(config.googleClientSecret),
    google_redirect_uri: Boolean(redirectUri)
  };
}

export async function getGoogleContactsStatus(origin = "") {
  const integration = await getGoogleContactsIntegration();
  const checks = googleConfigChecks(origin);
  const missing = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
    checks,
    connected: Boolean(
      integration.connected &&
        (integration.tokens?.refreshToken || integration.tokens?.accessToken)
    ),
    redirectUri: checks.google_redirect_uri
      ? getGoogleContactsRedirectUri(origin)
      : "",
    scope: integration.tokens?.scope || getScopeList().join(" "),
    lastSyncAt: integration.lastSyncAt || null,
    lastSyncSummary: integration.lastSyncSummary || null
  };
}

export async function beginGoogleContactsOAuth(origin = "") {
  requireConfig("GOOGLE_CLIENT_ID", config.googleClientId);

  const redirectUri = getGoogleContactsRedirectUri(origin);
  const state = crypto.randomBytes(24).toString("hex");
  const scope = getScopeList();

  await updateGoogleContactsIntegration((current) => ({
    ...current,
    oauthState: {
      value: state,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
    }
  }));

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

async function postGoogleToken(params) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Google token exchange failed ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function exchangeCodeForTokens({ code, redirectUri }) {
  requireConfig("GOOGLE_CLIENT_ID", config.googleClientId);
  requireConfig("GOOGLE_CLIENT_SECRET", config.googleClientSecret);

  return postGoogleToken({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
}

async function refreshGoogleAccessToken(refreshToken) {
  requireConfig("GOOGLE_CLIENT_ID", config.googleClientId);
  requireConfig("GOOGLE_CLIENT_SECRET", config.googleClientSecret);

  return postGoogleToken({
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
}

function mapGooglePersonToContacts(person) {
  const primaryName = findPrimary(person.names || []);
  const displayName =
    primaryName?.displayName ||
    primaryName?.unstructuredName ||
    primaryName?.givenName ||
    "";
  const emails = (person.emailAddresses || [])
    .map((entry) => String(entry.value || "").trim().toLowerCase())
    .filter(Boolean);
  const aliasSet = new Set();

  for (const entry of person.names || []) {
    for (const value of [
      entry.displayName,
      entry.unstructuredName,
      entry.givenName,
      entry.familyName
    ]) {
      const clean = String(value || "").trim();
      if (clean) {
        aliasSet.add(clean);
      }
    }
  }

  for (const entry of person.nicknames || []) {
    const clean = String(entry.value || "").trim();
    if (clean) {
      aliasSet.add(clean);
    }
  }

  for (const email of emails) {
    aliasSet.add(email);
  }

  const phones = (person.phoneNumbers || [])
    .map((entry) => normalizePhone(entry.canonicalForm || entry.value || ""))
    .filter(Boolean);

  if (!phones.length) {
    return {
      contacts: [],
      skippedWithoutPhone: 1
    };
  }

  const aliases = [...aliasSet].filter((value) => value !== displayName);
  const contacts = phones.map((phone) => ({
    name: displayName || phone,
    phone,
    aliases,
    emails,
    providers: {
      googleContacts: {
        resourceName: person.resourceName || "",
        syncedAt: nowIso()
      }
    }
  }));

  return {
    contacts,
    skippedWithoutPhone: 0
  };
}

export function extractGoogleContactImports(people = []) {
  const imports = [];
  let skippedWithoutPhone = 0;

  for (const person of people) {
    const mapped = mapGooglePersonToContacts(person);
    imports.push(...mapped.contacts);
    skippedWithoutPhone += mapped.skippedWithoutPhone;
  }

  return {
    contacts: imports,
    skippedWithoutPhone
  };
}

async function fetchGoogleConnectionsPage(accessToken, pageToken = "") {
  const url = new URL(GOOGLE_CONNECTIONS_URL);
  url.searchParams.set(
    "personFields",
    "names,emailAddresses,phoneNumbers,nicknames"
  );
  url.searchParams.set("pageSize", "1000");

  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Google People API failed ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function ensureFreshGoogleAccessToken(origin = "") {
  const integration = await getGoogleContactsIntegration();
  const tokens = integration.tokens || {};

  if (!integration.connected || (!tokens.accessToken && !tokens.refreshToken)) {
    throw new Error("Google Contacts is not connected yet.");
  }

  if (tokens.accessToken && (tokens.expiryDate || 0) > Date.now() + 60 * 1000) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    throw new Error(
      "Google Contacts access token expired and no refresh token is available."
    );
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
  const nextTokens = {
    ...tokens,
    accessToken: refreshed.access_token,
    tokenType: refreshed.token_type || tokens.tokenType || "Bearer",
    scope: refreshed.scope || tokens.scope || getScopeList().join(" "),
    expiryDate: expiryDateFromSeconds(refreshed.expires_in),
    obtainedAt: nowIso()
  };

  await updateGoogleContactsIntegration((current) => ({
    ...current,
    connected: true,
    tokens: nextTokens
  }));

  return nextTokens.accessToken;
}

export async function completeGoogleContactsOAuth({
  code,
  state,
  origin = ""
}) {
  const integration = await getGoogleContactsIntegration();
  const oauthState = integration.oauthState;

  if (!oauthState?.value || oauthState.value !== state) {
    throw new Error("Invalid Google OAuth state.");
  }

  if (!oauthState.expiresAt || new Date(oauthState.expiresAt).getTime() < Date.now()) {
    throw new Error("Google OAuth state expired. Please reconnect and try again.");
  }

  const redirectUri = getGoogleContactsRedirectUri(origin);
  const tokenPayload = await exchangeCodeForTokens({ code, redirectUri });
  const nextTokens = {
    accessToken: tokenPayload.access_token,
    refreshToken:
      tokenPayload.refresh_token || integration.tokens?.refreshToken || "",
    tokenType: tokenPayload.token_type || "Bearer",
    scope: tokenPayload.scope || getScopeList().join(" "),
    expiryDate: expiryDateFromSeconds(tokenPayload.expires_in),
    obtainedAt: nowIso()
  };

  await updateGoogleContactsIntegration((current) => ({
    ...current,
    connected: true,
    oauthState: null,
    tokens: nextTokens
  }));

  return syncGoogleContacts(origin);
}

export async function syncGoogleContacts(origin = "") {
  const accessToken = await ensureFreshGoogleAccessToken(origin);

  let pageToken = "";
  let pages = 0;
  let peopleSeen = 0;
  let importedContacts = 0;
  let skippedWithoutPhone = 0;

  do {
    const payload = await fetchGoogleConnectionsPage(accessToken, pageToken);
    const people = payload.connections || [];
    const extracted = extractGoogleContactImports(people);

    pages += 1;
    peopleSeen += people.length;
    skippedWithoutPhone += extracted.skippedWithoutPhone;

    for (const contact of extracted.contacts) {
      await upsertContact(contact);
      importedContacts += 1;
    }

    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  const summary = {
    importedContacts,
    peopleSeen,
    skippedWithoutPhone,
    pages,
    syncedAt: nowIso()
  };

  await updateGoogleContactsIntegration((current) => ({
    ...current,
    connected: true,
    lastSyncAt: summary.syncedAt,
    lastSyncSummary: summary
  }));

  return summary;
}
