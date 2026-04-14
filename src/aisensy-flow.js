function valueAtPath(payload, path) {
  return path.split(".").reduce((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return current[segment];
  }, payload);
}

function firstString(payload, searchParams, paths) {
  for (const path of paths) {
    const value = valueAtPath(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  for (const path of paths) {
    const value = searchParams.get(path);
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function isUnresolvedAttribute(value) {
  return /^\$[A-Za-z][\w]*$/.test(String(value || "").trim());
}

function cleanAttributeValue(value) {
  return isUnresolvedAttribute(value) ? "" : value;
}

export function extractAiSensyFlowInput(payload = {}, searchParams = new URLSearchParams()) {
  const source = payload && typeof payload === "object" ? payload : {};

  const from = firstString(source, searchParams, [
    "from",
    "phone",
    "mobile",
    "destination",
    "wa_id",
    "user.phone",
    "user.mobile",
    "contact.phone",
    "contact.mobile",
    "customer.phone",
    "customer.mobile",
    "data.from",
    "data.phone",
    "attributes.phone",
    "attributes.mobile",
    "attributes.whatsapp"
  ]);

  const text = firstString(source, searchParams, [
    "text",
    "message",
    "query",
    "question",
    "userMessage",
    "lastMessage",
    "last_message",
    "incoming_message",
    "body",
    "message.text",
    "data.text",
    "data.message",
    "attributes.text",
    "attributes.message",
    "attributes.last_message",
    "custom.text",
    "custom.message"
  ]);

  const profileName = firstString(source, searchParams, [
    "profileName",
    "name",
    "userName",
    "user.name",
    "contact.name",
    "customer.name",
    "data.name",
    "attributes.name"
  ]);

  const messageId = firstString(source, searchParams, [
    "messageId",
    "message_id",
    "id",
    "data.messageId",
    "data.message_id",
    "attributes.message_id"
  ]);

  return {
    from: cleanAttributeValue(from),
    text: cleanAttributeValue(text),
    profileName: cleanAttributeValue(profileName),
    messageId: cleanAttributeValue(messageId)
  };
}
