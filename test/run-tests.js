import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectLanguageStyle,
  isLanguageCompatible
} from "../src/lib/language.js";
import { cleanUserFacingText } from "../src/lib/text.js";
import { comparablePhone, normalizePhone } from "../src/lib/phones.js";
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
