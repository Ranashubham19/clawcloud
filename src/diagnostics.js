import { config } from "./config.js";

function present(value) {
  return Boolean(String(value || "").trim());
}

export function getReadinessReport() {
  const checks = {
    nvidia_api_key: present(config.nvidiaApiKey),
    nvidia_model: present(config.nvidiaModel),
    whatsapp_verify_token: present(config.whatsappVerifyToken),
    whatsapp_access_token: present(config.whatsappAccessToken),
    whatsapp_phone_number_id: present(config.whatsappPhoneNumberId),
    whatsapp_app_secret_optional: present(config.whatsappAppSecret)
  };

  const requiredKeys = [
    "nvidia_api_key",
    "nvidia_model",
    "whatsapp_verify_token",
    "whatsapp_access_token",
    "whatsapp_phone_number_id"
  ];

  const missing = requiredKeys.filter((key) => !checks[key]);

  return {
    ready: missing.length === 0,
    missing,
    checks,
    service: config.botName,
    model: config.nvidiaModel,
    timezone: config.timezone
  };
}
