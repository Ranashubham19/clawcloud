import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { comparablePhone, normalizePhone } from "../src/lib/phones.js";
import { buildProfessionalFallbackReply, getProfessionalQuickReply } from "../src/replies.js";
import { extractIncomingMessages } from "../src/whatsapp.js";

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
  assert.match(reply, /How may I assist you today/i);
});

await run("fallback reply stays professional for general messages", async () => {
  const reply = buildProfessionalFallbackReply({
    text: "I need details",
    profileName: "Shubham"
  });

  assert.match(reply, /Thank you for your message Shubham/i);
  assert.match(reply, /professional answer/i);
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

if (process.exitCode) {
  process.exit(process.exitCode);
}
