import { config } from "../src/config.js";
import { formatMetaApiError } from "../src/whatsapp.js";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function present(value) {
  return Boolean(String(value || "").trim());
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

function isMetaTestNumber(phone) {
  const displayPhoneNumber = String(phone?.display_phone_number || "");
  const verifiedName = String(phone?.verified_name || "");

  return (
    verifiedName.toLowerCase() === "test number" ||
    displayPhoneNumber.replace(/\D/g, "").startsWith("1555")
  );
}

async function main() {
  const localChecks = {
    nvidia_api_key: present(config.nvidiaApiKey),
    whatsapp_access_token: present(config.whatsappAccessToken),
    whatsapp_phone_number_id: present(config.whatsappPhoneNumberId),
    whatsapp_business_account_id: present(config.whatsappBusinessAccountId),
    whatsapp_app_secret: present(config.whatsappAppSecret)
  };

  const missing = Object.entries(localChecks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const failures = [];
  const warnings = [];
  let debug = null;
  let phone = null;

  if (missing.includes("whatsapp_app_secret")) {
    failures.push("missing_whatsapp_app_secret");
  }

  if (
    present(config.whatsappAccessToken) &&
    present(config.whatsappPhoneNumberId) &&
    present(config.whatsappBusinessAccountId)
  ) {
    const token = encodeURIComponent(config.whatsappAccessToken);
    debug = await graphGet(
      `debug_token?input_token=${token}&access_token=${token}`
    );
    phone = await graphGet(
      `${config.whatsappPhoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`
    );
  } else {
    failures.push("missing_meta_credentials");
  }

  if (!debug?.data?.is_valid) {
    failures.push("meta_token_invalid");
  }

  if (debug?.data?.type === "USER") {
    failures.push("temporary_user_token");
  }

  if (isMetaTestNumber(phone)) {
    failures.push("meta_test_phone_number");
  }

  if (!phone?.display_phone_number) {
    failures.push("phone_number_not_visible_to_token");
  }

  if (!phone?.quality_rating) {
    warnings.push("quality_rating_not_available_yet");
  }

  console.log(
    JSON.stringify(
      {
        public_ready: missing.length === 0 && failures.length === 0,
        missing,
        failures,
        warnings,
        token_type: debug?.data?.type || null,
        token_app_id: debug?.data?.app_id || null,
        phone_number_id: phone?.id || config.whatsappPhoneNumberId,
        display_phone_number: phone?.display_phone_number || null,
        verified_name: phone?.verified_name || null,
        quality_rating: phone?.quality_rating || null
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  fail(`Public launch check failed: ${error.message}`);
});
