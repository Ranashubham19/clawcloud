import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectLanguageStyle,
  isLanguageCompatible
} from "../src/lib/language.js";
import { comparablePhone, normalizePhone } from "../src/lib/phones.js";
import { buildProfessionalFallbackReply, getProfessionalQuickReply } from "../src/replies.js";
import { extractIncomingMessages, splitWhatsAppMessage } from "../src/whatsapp.js";
import { extractGoogleContactImports } from "../src/google-contacts.js";

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

await run("extractIncomingMessages reads text payloads", async () => {
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

  const messages = extractIncomingMessages(payload);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].profileName, "Shubham");
  assert.equal(messages[0].text, "Hello");
});

await run("quick reply returns a professional greeting", async () => {
  const reply = getProfessionalQuickReply({
    text: "HELLO",
    profileName: "Shubham"
  });

  assert.match(reply, /Hello Shubham/i);
  assert.match(reply, /how may I help you today/i);
});

await run("fallback reply stays professional for general messages", async () => {
  const reply = buildProfessionalFallbackReply({
    text: "I need details",
    profileName: "Shubham"
  });

  assert.match(reply, /Thank you for your message Shubham/i);
  assert.match(reply, /precise answer/i);
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

await run("handleIncomingText answers greetings without the model", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claw-cloud-"));
  process.env.CLAW_DATA_DIR = tempDir;

  const agent = await import(`../src/agent.js?ts=${Date.now()}`);
  const store = await import(`../src/store.js?ts=${Date.now()}`);
  await store.initStore();

  const reply = await agent.handleIncomingText({
    messageId: "wamid-greeting",
    from: "919999999999",
    profileName: "Shubham",
    text: "Hello"
  });

  const history = await store.getConversation("919999999999");

  assert.match(reply, /Hello Shubham/i);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[1].role, "assistant");

  await rm(tempDir, { recursive: true, force: true });
});

await run("createChatCompletion accepts custom maxTokens", async () => {
  const nvidia = await import(`../src/nvidia.js?ts=${Date.now()}`);
  assert.equal(typeof nvidia.createChatCompletion, "function");
  assert.ok(nvidia.DEFAULT_NVIDIA_MODELS.length >= 10);
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

if (process.exitCode) {
  process.exit(process.exitCode);
}
