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

  const businessId = firstString(source, searchParams, [
    "businessId",
    "business_id",
    "workspaceId",
    "workspace_id",
    "tenantId",
    "tenant_id",
    "data.businessId",
    "data.business_id",
    "attributes.businessId",
    "attributes.business_id"
  ]);

  const phoneNumberId = firstString(source, searchParams, [
    "phoneNumberId",
    "phone_number_id",
    "channel.phoneNumberId",
    "channel.phone_number_id",
    "data.phoneNumberId",
    "data.phone_number_id",
    "attributes.phoneNumberId",
    "attributes.phone_number_id"
  ]);

  const displayPhoneNumber = firstString(source, searchParams, [
    "displayPhoneNumber",
    "display_phone_number",
    "channel.displayPhoneNumber",
    "channel.display_phone_number",
    "channelPhone",
    "channel_phone",
    "data.displayPhoneNumber",
    "data.display_phone_number",
    "attributes.displayPhoneNumber",
    "attributes.display_phone_number"
  ]);

  const timestamp = firstString(source, searchParams, [
    "timestamp",
    "createdAt",
    "created_at",
    "eventTime",
    "event_time",
    "data.timestamp",
    "data.createdAt",
    "attributes.timestamp"
  ]);

  const mediaId = firstString(source, searchParams, [
    "mediaId",
    "media_id",
    "attachment.id",
    "data.mediaId",
    "data.media_id",
    "attributes.mediaId",
    "attributes.media_id"
  ]);

  const mediaType = firstString(source, searchParams, [
    "mediaType",
    "media_type",
    "attachment.type",
    "data.mediaType",
    "data.media_type",
    "attributes.mediaType",
    "attributes.media_type"
  ]);

  const mimeType = firstString(source, searchParams, [
    "mimeType",
    "mime_type",
    "attachment.mimeType",
    "attachment.mime_type",
    "data.mimeType",
    "data.mime_type",
    "attributes.mimeType",
    "attributes.mime_type"
  ]);

  const caption = firstString(source, searchParams, [
    "caption",
    "attachment.caption",
    "data.caption",
    "attributes.caption"
  ]);

  const filename = firstString(source, searchParams, [
    "filename",
    "fileName",
    "attachment.filename",
    "attachment.fileName",
    "data.filename",
    "attributes.filename"
  ]);

  return {
    from: cleanAttributeValue(from),
    text: cleanAttributeValue(text),
    profileName: cleanAttributeValue(profileName),
    messageId: cleanAttributeValue(messageId),
    businessId: cleanAttributeValue(businessId),
    phoneNumberId: cleanAttributeValue(phoneNumberId),
    displayPhoneNumber: cleanAttributeValue(displayPhoneNumber),
    timestamp: cleanAttributeValue(timestamp),
    mediaId: cleanAttributeValue(mediaId),
    mediaType: cleanAttributeValue(mediaType),
    mimeType: cleanAttributeValue(mimeType),
    caption: cleanAttributeValue(caption),
    filename: cleanAttributeValue(filename)
  };
}
