import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectLanguageStyle,
  isLanguageCompatible
} from "../src/lib/language.js";
import { config } from "../src/config.js";
import {
  cleanUserFacingText,
  formatSourceAttribution,
  sanitizeForWhatsApp
} from "../src/lib/text.js";
import { comparablePhone, normalizePhone } from "../src/lib/phones.js";
import { buildAiSensyCampaignPayload, splitWhatsAppMessage } from "../src/whatsapp.js";
import { extractGoogleContactImports } from "../src/google-contacts.js";
import { extractAiSensyFlowInput } from "../src/aisensy-flow.js";
import { extractGeminiGroundingSources } from "../src/gemini.js";
import {
  detectMessagingProvider,
  extractInboundMessages,
  verifyMessagingWebhookGet
} from "../src/messaging.js";
import { buildMessagingWebhookSuccessResponse } from "../src/messaging.js";
import {
  extractTelegramInbound,
  getTelegramBotInfo,
  getTelegramWebhookInfo,
  sendTelegramMessage,
  setTelegramWebhook
} from "../src/telegram.js";

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await run("normalizePhone keeps leading plus", async () => {
  assert.equal(normalizePhone("+91 78768 31969"), "+917876831969");
});

await run("normalizePhone upgrades 00 prefix", async () => {
  assert.equal(normalizePhone("0091-98765-43210"), "+919876543210");
});

await run("comparablePhone strips plus", async () => {
  assert.equal(comparablePhone("+919876543210"), "919876543210");
});

await run("detectLanguageStyle keeps English in English", async () => {
  assert.equal(
    detectLanguageStyle("When was Claude Opus 4.6 released"),
    "english"
  );
});

await run("detectLanguageStyle catches Hinglish in Roman script", async () => {
  assert.equal(
    detectLanguageStyle("claude opus 4.6 kab release hua tha"),
    "hinglish"
  );
});

await run("chooseAnswerRoute sends technical questions to NVIDIA stack", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(
    agent.chooseAnswerRoute("Write a Python function for binary search"),
    "nvidia"
  );
});

await run("chooseAnswerRoute sends current affairs to Gemini first", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(
    agent.chooseAnswerRoute("Top 10 richest people in the world 2026"),
    "gemini-first"
  );
});

await run("chooseAnswerRoute sends greetings through the model path", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(agent.chooseAnswerRoute("Hello"), "nvidia");
});

await run("chooseAnswerRoute keeps live lookup questions on Gemini first", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(agent.chooseAnswerRoute("look up the latest AI news"), "gemini-first");
});

await run("chooseAnswerRoute keeps WhatsApp history commands on NVIDIA tools", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(agent.chooseAnswerRoute("show recent WhatsApp history"), "nvidia-tools");
});

await run("directSmallTalkReply keeps how are you professional", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(
    agent.directSmallTalkReply("how are you", "english"),
    "I'm doing well, thank you. How may I assist you today?"
  );
});

await run("directSmallTalkReply handles capability questions professionally", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(
    agent.directSmallTalkReply("what all you can do", "english"),
    "I can answer questions clearly and professionally, explain concepts, help with writing, coding, math, planning, and everyday problem-solving. Send me any question, and I'll give you a direct and accurate answer."
  );
});

await run("shouldUseWhatsAppTools stays off for normal questions", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(agent.shouldUseWhatsAppTools("how are you"), false);
  assert.equal(agent.shouldUseWhatsAppTools("what can you do"), false);
});

await run("shouldUseWhatsAppTools stays on for explicit WhatsApp actions", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(agent.shouldUseWhatsAppTools("show recent WhatsApp history"), true);
  assert.equal(agent.shouldUseWhatsAppTools("send a message to Raj"), true);
});

await run("isLanguageCompatible rejects Devanagari for English answers", async () => {
  assert.equal(
    isLanguageCompatible("Claude Opus 4.6 was released on February 5, 2026.", "english"),
    true
  );
  assert.equal(
    isLanguageCompatible("Claude Opus 4.6 को 5 फरवरी 2026 को रिलीज किया गया था।", "english"),
    false
  );
});

await run("isLanguageCompatible requires Roman script for Hinglish", async () => {
  assert.equal(
    isLanguageCompatible("Claude Opus 4.6 ko 5 February 2026 ko release kiya gaya tha.", "hinglish"),
    true
  );
  assert.equal(
    isLanguageCompatible("Claude Opus 4.6 को 5 फरवरी 2026 को रिलीज किया गया था।", "hinglish"),
    false
  );
});

await run("extractInboundMessages normalizes Meta text payloads", async () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Shubham" } }],
              messages: [
                {
                  id: "wamid.1",
                  from: "919999999999",
                  type: "text",
                  text: { body: "Hello" }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  const messages = extractInboundMessages({
    provider: "meta",
    payload,
    url: new URL("http://localhost/webhooks/whatsapp")
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].provider, "meta");
  assert.equal(messages[0].profileName, "Shubham");
  assert.equal(messages[0].text, "Hello");
  assert.equal(messages[0].providerMessageId, "wamid.1");
  assert.equal(messages[0].messageId, "meta:wamid.1");
});

await run("extractTelegramInbound normalizes Telegram text payloads", async () => {
  const inbound = extractTelegramInbound({
    message: {
      message_id: 42,
      date: 1710000000,
      text: "Hello from Telegram",
      from: {
        id: 987654321,
        first_name: "Ada",
        last_name: "Lovelace",
        username: "ada"
      },
      chat: {
        id: 987654321
      }
    }
  });

  assert.equal(inbound.provider, "telegram");
  assert.equal(inbound.from, "987654321");
  assert.equal(inbound.chatId, "987654321");
  assert.equal(inbound.text, "Hello from Telegram");
  assert.equal(inbound.profileName, "Ada Lovelace");
  assert.equal(inbound.messageId, "telegram:42");
  assert.equal(inbound.timestamp, "1710000000");
});

await run("setTelegramWebhook throws when Telegram rejects the webhook", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      description: "Bad Request: bad webhook"
    })
  });

  try {
    await assert.rejects(
      () => setTelegramWebhook("token", "https://example.com/webhooks/telegram/biz-1"),
      /bad webhook/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("getTelegramBotInfo throws when Telegram rejects the token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      description: "Unauthorized"
    })
  });

  try {
    await assert.rejects(() => getTelegramBotInfo("bad-token"), /unauthorized/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("getTelegramWebhookInfo returns Telegram webhook metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      result: {
        url: "https://example.com/webhooks/telegram/biz-1"
      }
    })
  });

  try {
    const info = await getTelegramWebhookInfo("token");
    assert.equal(info.result.url, "https://example.com/webhooks/telegram/biz-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("sendTelegramMessage renders starred headings as Telegram bold HTML", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } })
    };
  };

  try {
    await sendTelegramMessage(
      "token",
      "123456",
      "Here is the update:\n\n- *Top Story*: Something happened"
    );
    assert.equal(requestBody.parse_mode, "HTML");
    assert.match(requestBody.text, /<b>Top Story<\/b>/);
    assert.equal(requestBody.text.includes("*Top Story*"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("sendTelegramMessage throws when Telegram rejects the reply", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      description: "Forbidden: bot was blocked by the user"
    })
  });

  try {
    await assert.rejects(
      () => sendTelegramMessage("token", "123456", "hello"),
      /blocked by the user/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await run("extractAiSensyFlowInput reads flexible flow payloads", async () => {
  const input = extractAiSensyFlowInput({
    contact: { phone: "918091392311", name: "Shubh" },
    message: "What is zapma",
    message_id: "flow-1"
  });

  assert.deepEqual(input, {
    from: "918091392311",
    text: "What is zapma",
    profileName: "Shubh",
    messageId: "flow-1",
    businessId: "",
    phoneNumberId: "",
    displayPhoneNumber: "",
    timestamp: "",
    mediaId: "",
    mediaType: "",
    mimeType: "",
    caption: "",
    filename: ""
  });
});

await run("extractAiSensyFlowInput falls back to query params", async () => {
  const input = extractAiSensyFlowInput(
    {},
    new URLSearchParams({
      phone: "918091392311",
      text: "Hello",
      name: "Shubh"
    })
  );

  assert.equal(input.from, "918091392311");
  assert.equal(input.text, "Hello");
  assert.equal(input.profileName, "Shubh");
});

await run("verifyMessagingWebhookGet accepts AiSensy token on GET routes", async () => {
  const previousToken = config.aisensyFlowToken;
  config.aisensyFlowToken = "test-flow-token";

  try {
    const verification = verifyMessagingWebhookGet({
      provider: "aisensy",
      headers: {
        authorization: "Bearer test-flow-token"
      },
      url: new URL("http://localhost/integrations/aisensy/answer")
    });

    assert.equal(verification.ok, true);
  } finally {
    config.aisensyFlowToken = previousToken;
  }
});

await run("extractAiSensyFlowInput ignores unresolved attributes", async () => {
  const input = extractAiSensyFlowInput({
    from: "$phone",
    profileName: "$name",
    text: "$message"
  });

  assert.equal(input.from, "");
  assert.equal(input.text, "");
  assert.equal(input.profileName, "");
});

await run("extractInboundMessages normalizes AiSensy payloads", async () => {
  const messages = extractInboundMessages({
    provider: "aisensy",
    payload: {
      contact: { phone: "918091392311", name: "Shubh" },
      message: "What is zapma",
      message_id: "flow-1",
      businessId: "biz-1",
      display_phone_number: "+919876543210"
    },
    url: new URL("http://localhost/webhooks/aisensy")
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].provider, "aisensy");
  assert.ok(messages[0].messageId.startsWith("aisensy:derived:"));
  assert.equal(messages[0].providerMessageId, "flow-1");
  assert.equal(messages[0].businessId, "biz-1");
  assert.equal(messages[0].displayPhoneNumber, "+919876543210");
  assert.equal(messages[0].text, "What is zapma");
});

await run("detectMessagingProvider infers path and payload", async () => {
  assert.equal(
    detectMessagingProvider({
      url: new URL("http://localhost/webhooks/whatsapp")
    }),
    "meta"
  );
  assert.equal(
    detectMessagingProvider({
      url: new URL("http://localhost/webhooks/messaging"),
      payload: { contact: { phone: "918091392311" }, message: "Hi" }
    }),
    "aisensy"
  );
});

await run("buildMessagingWebhookSuccessResponse keeps meta webhooks acknowledged", async () => {
  const response = buildMessagingWebhookSuccessResponse({
    provider: "meta",
    messageCount: 0
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.provider, "meta");
  assert.equal(response.body.received, true);
  assert.equal(response.body.messages, 0);
});

await run("buildMessagingWebhookSuccessResponse preserves full AiSensy reply formatting", async () => {
  const response = buildMessagingWebhookSuccessResponse({
    provider: "aisensy",
    reply: "*Overview*\n\nNamaste,\nYeh ek detailed answer hai."
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.format, "json");
  assert.equal(response.body.botreply, "*Overview*\n\nNamaste,\nYeh ek detailed answer hai.");
  assert.equal(response.body.text, "*Overview*\n\nNamaste,\nYeh ek detailed answer hai.");
  assert.equal(response.body.compactReply, "*Overview* Namaste, Yeh ek detailed answer hai.");
});

await run("cleanUserFacingText removes tool and search meta lines", async () => {
  const cleaned = cleanUserFacingText(
    `[TOOL_CALLS]web_search{"query":"latest price"}\nI'll check the latest price for you.\n(Using web search to find the current price)\nThe latest price is $1,199.`
  );

  assert.equal(cleaned, "The latest price is $1,199.");
});

await run("cleanUserFacingText strips Gemini cite blobs", async () => {
  const cleaned = cleanUserFacingText(
    "The top person is Elon Musk. [cite: 1, 2, 3]"
  );

  assert.equal(cleaned, "The top person is Elon Musk.");
});

await run("sanitizeForWhatsApp strips decorative symbols and keeps clean spacing", async () => {
  const cleaned = sanitizeForWhatsApp(
    "✨## Answer\n• First point\n• Second point\n\nThis is a very long paragraph that should not stay fully bold because it is much too long to be a proper short heading inside the WhatsApp reply format.*"
  );

  assert.equal(cleaned.includes("✨"), false);
  assert.equal(cleaned.includes("•"), false);
  assert.match(cleaned, /\*Answer\*/);
  assert.match(cleaned, /- First point/);
});

await run("extractGeminiGroundingSources keeps grounded web sources in support order", async () => {
  const sources = extractGeminiGroundingSources({
    groundingMetadata: {
      groundingChunks: [
        {
          web: {
            uri: "https://www.reuters.com/world/example-story",
            title: "Reuters story"
          }
        },
        {
          web: {
            uri: "https://apnews.com/article/example",
            title: "AP story"
          }
        },
        {
          web: {
            uri: "https://www.bbc.com/news/example",
            title: "BBC story"
          }
        }
      ],
      groundingSupports: [
        { groundingChunkIndices: [1, 0] },
        { groundingChunkIndices: [1, 2] }
      ]
    }
  });

  assert.deepEqual(
    sources.map((source) => source.domain),
    ["apnews.com", "reuters.com", "bbc.com"]
  );
});

await run("formatSourceAttribution builds compact source summary", async () => {
  const formatted = formatSourceAttribution([
    {
      title: "Reuters story",
      domain: "reuters.com",
      uri: "https://www.reuters.com/world/example-story"
    },
    {
      title: "AP story",
      domain: "apnews.com",
      uri: "https://apnews.com/article/example"
    },
    {
      title: "BBC story",
      domain: "bbc.com",
      uri: "https://www.bbc.com/news/example"
    },
    {
      title: "CNN story",
      domain: "cnn.com",
      uri: "https://www.cnn.com/world/example"
    }
  ]);

  assert.match(formatted, /\*Sources\*: reuters\.com, apnews\.com, bbc\.com \+1 more/);
  assert.match(formatted, /\*See details\*/);
  assert.match(
    formatted,
    /1\. Reuters story \(reuters\.com\): https:\/\/www\.reuters\.com\/world\/example-story/
  );
});

await run("beginInboundProcessing dedupes repeated message ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();

  const first = await store.beginInboundProcessing("wamid-1");
  const second = await store.beginInboundProcessing("wamid-1");

  assert.equal(first.status, "accepted");
  assert.equal(second.status, "duplicate");

  await rm(tempDir, { recursive: true, force: true });
});

await run("getInboundProcessingResult returns stored replies for inline duplicates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  await store.beginInboundProcessing("wamid-inline-1");
  await store.completeInboundProcessing("wamid-inline-1", {
    reply: "I'm doing well, thanks. How can I help you today?",
    outcome: "answered"
  });

  const saved = await store.getInboundProcessingResult("wamid-inline-1");
  assert.equal(saved.reply, "I'm doing well, thanks. How can I help you today?");

  await rm(tempDir, { recursive: true, force: true });
});

await run("initStore prunes stale inbound processing records", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  await writeFile(
    path.join(tempDir, "meta.json"),
    `${JSON.stringify(
      {
        inbound: {
          "wamid-stale": {
            status: "processing",
            startedAt: "2026-04-11T21:16:12.452Z"
          },
          "wamid-done": {
            status: "done",
            finishedAt: "2026-04-12T00:00:00.000Z"
          }
        },
        outbound: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();

  const meta = JSON.parse(await readFile(path.join(tempDir, "meta.json"), "utf8"));

  assert.equal(meta.inbound["wamid-stale"], undefined);
  assert.equal(meta.inbound["wamid-done"].status, "done");

  await rm(tempDir, { recursive: true, force: true });
});

await run("claimDueReminders leases each due reminder once", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  const reminders = await store.createReminder({
    targetPhone: "+919876543210",
    text: "Ping",
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    sourceChatId: "+919876543210",
    createdBy: "+919876543210"
  });

  const firstClaim = await store.claimDueReminders(new Date());
  const secondClaim = await store.claimDueReminders(new Date());
  const [storedReminder] = await store.listReminders(reminders[0].targetPhone);

  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0].id, reminders[0].id);
  assert.equal(secondClaim.length, 0);
  assert.equal(storedReminder.status, "processing");

  await rm(tempDir, { recursive: true, force: true });
});

await run("markReminderFailed backs off transient reminder errors", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  const reminders = await store.createReminder({
    targetPhone: "+919876543210",
    text: "Ping",
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    sourceChatId: "+919876543210",
    createdBy: "+919876543210"
  });

  await store.claimDueReminders(new Date());
  await store.markReminderFailed(reminders[0].id, "RATE_LIMITED");

  const [storedReminder] = await store.listReminders(reminders[0].targetPhone);
  const dueNow = await store.getDueReminders(new Date());

  assert.equal(storedReminder.status, "pending");
  assert.equal(storedReminder.attempts, 1);
  assert.ok(new Date(storedReminder.nextAttemptAt).getTime() > Date.now());
  assert.equal(dueNow.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});

await run("markReminderFailed permanently fails invalid reminder recipients", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  const reminders = await store.createReminder({
    targetPhone: "+919876543210",
    text: "Ping",
    dueAt: new Date(Date.now() - 60_000).toISOString(),
    sourceChatId: "+919876543210",
    createdBy: "+919876543210"
  });

  await store.claimDueReminders(new Date());
  await store.markReminderFailed(reminders[0].id, "RECIPIENT_NOT_ALLOWED");

  const [storedReminder] = await store.listReminders(reminders[0].targetPhone);
  const dueNow = await store.getDueReminders(new Date());

  assert.equal(storedReminder.status, "failed");
  assert.equal(storedReminder.attempts, 1);
  assert.ok(Boolean(storedReminder.failedAt));
  assert.equal(storedReminder.nextAttemptAt, null);
  assert.equal(dueNow.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});

await run("createChatCompletion uses exactly the selected 10-model NVIDIA stack", async () => {
  const nvidia = await import(`../src/nvidia.js?ts=${Date.now()}`);
  assert.equal(typeof nvidia.createChatCompletion, "function");
  assert.equal(nvidia.DEFAULT_NVIDIA_MODELS.length, 10);
  assert.equal(new Set(nvidia.DEFAULT_NVIDIA_MODELS).size, 10);
  assert.equal(nvidia.getConfiguredNvidiaModels().length, 10);
});

await run("isToolLeakText catches raw function-call JSON", async () => {
  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  assert.equal(
    agent.isToolLeakText('{"name":"min_cost","parameters":{"n":3}}'),
    true
  );
  assert.equal(agent.isToolLeakText('web_search(query="top 10 richest people")'), true);
  assert.equal(
    agent.isToolLeakText(
      'Here is the function call in JSON format: {"name":"web_search","parameters":{"query":"latest news"}}'
    ),
    true
  );
  assert.equal(agent.isToolLeakText("Use DP over subsets and return the minimum cost."), false);
});

await run("extractGoogleContactImports maps Google contacts with phones", async () => {
  const result = extractGoogleContactImports([
    {
      resourceName: "people/c123",
      names: [{ displayName: "Dii Sharma", givenName: "Dii" }],
      nicknames: [{ value: "Dii" }],
      emailAddresses: [{ value: "dii@example.com" }],
      phoneNumbers: [{ canonicalForm: "+919876543210" }]
    }
  ]);

  assert.equal(result.skippedWithoutPhone, 0);
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].name, "Dii Sharma");
  assert.equal(result.contacts[0].phone, "+919876543210");
  assert.match(result.contacts[0].aliases.join(" "), /Dii/i);
  assert.equal(result.contacts[0].emails[0], "dii@example.com");
});

await run("splitWhatsAppMessage chunks long replies safely", async () => {
  const text = "A".repeat(9000);
  const chunks = splitWhatsAppMessage(text, 3800);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].length <= 3800);
  assert.ok(chunks[1].length <= 3800);
  assert.ok(chunks[2].length <= 3800);
});

await run("buildAiSensyCampaignPayload maps replies into template params", async () => {
  config.aisensyApiKey = "test-key";
  config.aisensyCampaignName = "Claw Cloud Reply";
  const payload = buildAiSensyCampaignPayload({
    to: "918091392311",
    body: "Hello from AI"
  });

  assert.equal(payload.apiKey, "test-key");
  assert.equal(payload.campaignName, "Claw Cloud Reply");
  assert.equal(payload.destination, "918091392311");
  assert.deepEqual(payload.templateParams, ["Hello from AI"]);
});

await run("listContacts can find imported contact by email alias", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  await store.upsertContact({
    name: "Dii Sharma",
    phone: "+919876543210",
    emails: ["dii@example.com"],
    aliases: ["Dii"],
    providers: {
      googleContacts: {
        resourceName: "people/c123"
      }
    }
  });

  const matches = await store.listContacts("dii@example.com");

  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "Dii Sharma");

  await rm(tempDir, { recursive: true, force: true });
});

await run("listConversationThreads summarizes stored chats", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  await store.upsertContact({
    name: "Dii Sharma",
    phone: "+919876543210",
    aliases: ["Dii"]
  });
  await store.appendConversationMessage("+919876543210", {
    role: "user",
    text: "ab theek hai na",
    at: "2026-04-12T12:00:00.000Z"
  });

  const threads = await store.listConversationThreads({ query: "dii", limit: 10 });

  assert.equal(threads.length, 1);
  assert.equal(threads[0].contact.name, "Dii Sharma");
  assert.equal(threads[0].messageCount, 1);

  await rm(tempDir, { recursive: true, force: true });
});

await run("searchConversationHistory finds text across chats", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();
  await store.upsertContact({
    name: "Dii Sharma",
    phone: "+919876543210",
    aliases: ["Dii"]
  });
  await store.appendConversationMessage("+919876543210", {
    role: "user",
    text: "ab theek hai na",
    at: "2026-04-12T12:00:00.000Z"
  });

  const matches = await store.searchConversationHistory({
    query: "theek",
    limit: 10
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].contact.name, "Dii Sharma");
  assert.match(matches[0].message.text, /theek/i);

  await rm(tempDir, { recursive: true, force: true });
});

await run("business scoped conversation threads stay isolated per institute", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();

  await store.upsertContact({
    businessId: "biz-alpha",
    name: "Riya",
    phone: "+919999000001"
  });
  await store.upsertContact({
    businessId: "biz-beta",
    name: "Riya",
    phone: "+919999000001"
  });

  await store.appendConversationMessage(
    "+919999000001",
    {
      role: "user",
      text: "Need NEET timings",
      at: "2026-04-15T10:00:00.000Z"
    },
    { businessId: "biz-alpha" }
  );
  await store.appendConversationMessage(
    "+919999000001",
    {
      role: "user",
      text: "Need JEE batch details",
      at: "2026-04-15T11:00:00.000Z"
    },
    { businessId: "biz-beta" }
  );

  const alphaThreads = await store.listConversationThreads({
    businessId: "biz-alpha",
    limit: 10
  });
  const betaThreads = await store.listConversationThreads({
    businessId: "biz-beta",
    limit: 10
  });

  assert.equal(alphaThreads.length, 1);
  assert.equal(betaThreads.length, 1);
  assert.match(alphaThreads[0].lastMessage.text, /NEET/i);
  assert.match(betaThreads[0].lastMessage.text, /JEE/i);

  const alphaMatches = await store.searchConversationHistory({
    businessId: "biz-alpha",
    query: "JEE",
    limit: 10
  });

  assert.equal(alphaMatches.length, 0);

  await rm(tempDir, { recursive: true, force: true });
});

await run("saas store creates a workspace and resolves inbound WhatsApp mapping", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const saasStore = await import(`../src/saas-store.js?ts=${Date.now()}`);
  await saasStore.initSaasStore();

  const user = await saasStore.createSaasUser({
    name: "Shubham",
    email: "shubham@example.com",
    password: "supersecure123"
  });

  const business = await saasStore.createBusinessForUser(user.id, {
    name: "OpenClaw Academy",
    whatsappPhoneNumberId: "pn_123",
    whatsappDisplayPhoneNumber: "+919876543210",
    whatsappAccessToken: "token_123456"
  });

  const session = await saasStore.createSaasSession({
    userId: user.id,
    userAgent: "test-agent",
    ipAddress: "127.0.0.1"
  });

  const loadedSession = await saasStore.getSaasSession(session.token);
  const resolvedBusiness = await saasStore.getBusinessByInboundChannel({
    phoneNumberId: "pn_123"
  });

  assert.equal(loadedSession.user.email, "shubham@example.com");
  assert.equal(resolvedBusiness.id, business.id);
  assert.equal(resolvedBusiness.whatsapp.phoneNumberId, "pn_123");

  await rm(tempDir, { recursive: true, force: true });
});

await run("saas store exposes safe Telegram status without leaking the token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const saasStore = await import(`../src/saas-store.js?ts=${Date.now()}`);
  await saasStore.initSaasStore();

  const user = await saasStore.createSaasUser({
    name: "Aditi",
    email: "aditi@example.com",
    password: "supersecure123"
  });

  const business = await saasStore.createBusinessForUser(user.id, {
    name: "Telegram Academy"
  });

  await saasStore.updateBusinessTelegram(user.id, business.id, {
    token: "123456:telegram-secret-token",
    botUsername: "telegram_academy_bot",
    botName: "Telegram Academy Bot",
    webhookUrl: "https://example.com/webhooks/telegram/biz-1",
    connectedAt: "2026-04-18T10:00:00.000Z",
    webhookVerifiedAt: "2026-04-18T10:00:01.000Z"
  });

  const safeBusiness = await saasStore.getBusinessForUser(user.id, business.id);
  const rawMatch = await saasStore.findBusinessByTelegramToken(
    "123456:telegram-secret-token"
  );

  assert.equal(safeBusiness.telegram.configured, true);
  assert.equal(safeBusiness.telegram.tokenConfigured, true);
  assert.equal(safeBusiness.telegram.botUsername, "telegram_academy_bot");
  assert.equal(
    safeBusiness.telegram.webhookVerifiedAt,
    "2026-04-18T10:00:01.000Z"
  );
  assert.equal("token" in safeBusiness.telegram, false);
  assert.equal(rawMatch.id, business.id);

  await rm(tempDir, { recursive: true, force: true });
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
