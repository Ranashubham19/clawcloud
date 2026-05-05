import { config } from "../src/config.js";
import { formatMetaApiError } from "../src/whatsapp.js";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireLocalConfig(name, value) {
  if (!String(value || "").trim()) {
    fail(`Missing ${name}. Add it before running this check.`);
  }
}

async function graphGet(path) {
  const url = new URL(`https://graph.facebook.com/${config.whatsappGraphVersion}/${path}`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`
    }
  });

  const rawBody = await response.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(
      formatMetaApiError("Meta Graph API check failed", response.status, body, rawBody)
    );
  }

  return body;
}

async function main() {
  requireLocalConfig("WHATSAPP_ACCESS_TOKEN", config.whatsappAccessToken);
  requireLocalConfig("WHATSAPP_PHONE_NUMBER_ID", config.whatsappPhoneNumberId);

  const token = encodeURIComponent(config.whatsappAccessToken);
  const debug = await graphGet(
    `debug_token?input_token=${token}&access_token=${token}`
  );

  const granularScopes = debug?.data?.granular_scopes || [];
  const authorizedWabaIds = granularScopes
    .filter((scope) =>
      ["whatsapp_business_management", "whatsapp_business_messaging"].includes(
        scope.scope
      )
    )
    .flatMap((scope) => scope.target_ids || []);

  const uniqueWabaIds = [...new Set(authorizedWabaIds)];
  const phonesByWaba = [];

  for (const wabaId of uniqueWabaIds) {
    try {
      const phones = await graphGet(
        `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`
      );
      phonesByWaba.push({
        waba_id: wabaId,
        phone_numbers: phones.data || []
      });
    } catch (error) {
      phonesByWaba.push({
        waba_id: wabaId,
        error: error.message
      });
    }
  }

  const configuredPhone = phonesByWaba
    .flatMap((item) => item.phone_numbers || [])
    .find((phone) => phone.id === config.whatsappPhoneNumberId);

  const report = {
    token_valid: Boolean(debug?.data?.is_valid),
    token_type: debug?.data?.type,
    token_app_id: debug?.data?.app_id,
    authorized_waba_ids: uniqueWabaIds,
    configured_waba_id: config.whatsappBusinessAccountId || null,
    configured_phone_number_id: config.whatsappPhoneNumberId,
    configured_phone_number_found: Boolean(configuredPhone),
    phones_by_waba: phonesByWaba
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.token_valid) {
    process.exitCode = 1;
  } else if (!report.configured_phone_number_found) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Meta WhatsApp check failed: ${error.message}`);
  process.exit(1);
});
