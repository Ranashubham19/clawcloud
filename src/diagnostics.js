import { config } from "./config.js";
import { getDatabaseStorageStatus } from "./json-store.js";

function present(value) {
  return Boolean(String(value || "").trim());
}

export function getReadinessReport() {
  const provider = String(
    config.messagingProvider || config.whatsappProvider || "aisensy"
  )
    .trim()
    .toLowerCase();
  const checks = {
    messaging_provider: present(provider),
    nvidia_api_key: present(config.nvidiaApiKey),
    nvidia_model: present(config.nvidiaModel),
    gemini_api_key_optional: present(config.geminiApiKey),
    whatsapp_verify_token_meta: present(config.whatsappVerifyToken),
    whatsapp_access_token_meta: present(config.whatsappAccessToken),
    whatsapp_phone_number_id_meta: present(config.whatsappPhoneNumberId),
    whatsapp_business_account_id_optional: present(config.whatsappBusinessAccountId),
    whatsapp_app_secret_optional: present(config.whatsappAppSecret),
    aisensy_api_key: present(config.aisensyApiKey),
    aisensy_campaign_name: present(config.aisensyCampaignName),
    aisensy_flow_token: present(config.aisensyFlowToken),
    admin_api_token_optional: present(config.adminApiToken),
    google_client_id_optional: present(config.googleClientId),
    google_client_secret_optional: present(config.googleClientSecret),
    app_base_url_optional: present(config.appBaseUrl || config.googleRedirectUri),
    stripe_secret_key_optional: present(config.stripeSecretKey),
    stripe_webhook_secret_optional: present(config.stripeWebhookSecret),
    stripe_price_basic_optional: present(config.stripePriceBasic),
    stripe_price_pro_optional: present(config.stripePricePro),
    stripe_price_premium_optional: present(config.stripePricePremium)
  };

  const requiredKeys = [
    "nvidia_api_key",
    "nvidia_model",
    ...(provider === "meta"
      ? [
          "whatsapp_verify_token_meta",
          "whatsapp_access_token_meta",
          "whatsapp_phone_number_id_meta"
        ]
      : ["aisensy_api_key", "aisensy_campaign_name", "aisensy_flow_token"])
  ];

  const missing = requiredKeys.filter((key) => !checks[key]);

  return {
    ready: missing.length === 0,
    missing,
    checks,
    storage: getDatabaseStorageStatus(),
    service: config.botName,
    model: config.nvidiaModel,
    timezone: config.timezone,
    messagingProvider: provider
  };
}
