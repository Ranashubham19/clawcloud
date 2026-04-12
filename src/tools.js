import {
  cancelReminder,
  createReminder,
  getConversation,
  listConversationThreads,
  listContacts,
  listReminders,
  rememberOutboundDedup,
  searchConversationHistory,
  resolveContact,
  hasRecentOutboundDedup,
  upsertContact,
  appendConversationMessage
} from "./store.js";
import { normalizePhone } from "./lib/phones.js";
import { sendWhatsAppTextChunked, outboundDedupKey } from "./whatsapp.js";
import { webSearch } from "./search.js";

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "list_contacts",
      description:
        "List saved contacts, optionally filtered by name, alias, email, or phone number.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional search text."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_chat_threads",
      description:
        "List chat threads with saved history so the assistant can analyze known WhatsApp conversations.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional search text to filter threads by contact or recent message."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_contact",
      description: "Find a saved contact by name, alias, or phone number.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Name, alias, or phone number to look up."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_contact",
      description: "Create or update a contact so later messages can be sent by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          aliases: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["name", "phone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_recent_history",
      description:
        "Read the most recent messages for a chat by contact name, phone number, or the current chat.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Contact name, phone number, or current_chat."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 30
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_history",
      description:
        "Search saved WhatsApp conversation history across all known chats or within one contact thread.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search for inside saved conversation history."
          },
          target: {
            type: "string",
            description: "Optional contact name, phone number, or current_chat to limit the search."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description:
        "Schedule a reminder WhatsApp message for a person or for the current chat.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string" },
          when_iso: {
            type: "string",
            description: "ISO timestamp for when the reminder should be sent."
          },
          message: { type: "string" }
        },
        required: ["when_iso", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List reminders for a contact, phone number, or the current chat.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel a reminder by its reminder id.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "string" }
        },
        required: ["reminder_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp_message",
      description:
        "Send a WhatsApp text message to a saved contact, a phone number, or the current chat when the user explicitly asks to send something.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string" },
          message: { type: "string" }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for up-to-date information. Call this whenever the user asks about news, current events, recent updates, prices, scores, weather, anything time-sensitive, or anything that may have changed after your training cutoff. Returns ranked web results with titles, URLs, published dates, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language search query."
          },
          freshness: {
            type: "string",
            enum: ["day", "week", "month", "any"],
            description:
              "Optional time window: day = last 24h, week = last 7 days, month = last 30 days, any = no filter."
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 10
          }
        },
        required: ["query"]
      }
    }
  }
];

function result(data) {
  return JSON.stringify(data);
}

async function resolveTarget(target, context) {
  return resolveContact(target || "current_chat", context.currentUserPhone);
}

export async function executeTool(name, args, context) {
  switch (name) {
    case "list_contacts": {
      const contacts = await listContacts(args.query || "");
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      return result({
        count: contacts.length,
        contacts: contacts.slice(0, limit)
      });
    }

    case "list_chat_threads": {
      const threads = await listConversationThreads({
        query: args.query || "",
        limit: args.limit
      });
      return result({
        count: threads.length,
        threads
      });
    }

    case "lookup_contact": {
      const matches = await listContacts(args.query || "");
      return result({
        count: matches.length,
        matches
      });
    }

    case "save_contact": {
      await upsertContact({
        name: args.name,
        phone: args.phone,
        aliases: args.aliases || []
      });
      return result({
        saved: true,
        name: args.name,
        phone: normalizePhone(args.phone)
      });
    }

    case "get_recent_history": {
      const resolved = await resolveTarget(args.target, context);
      if (resolved.status !== "resolved") {
        return result(resolved);
      }
      const messages = await getConversation(
        resolved.contact.phone,
        Math.min(Math.max(Number(args.limit) || 12, 1), 30)
      );
      return result({
        target: resolved.contact,
        messages
      });
    }

    case "search_history": {
      const matches = await searchConversationHistory({
        query: args.query,
        target: args.target || "",
        limit: args.limit
      });
      return result({
        count: matches.length,
        matches
      });
    }

    case "create_reminder": {
      const resolved = await resolveTarget(args.target, context);
      if (resolved.status !== "resolved") {
        return result(resolved);
      }

      const dueAt = new Date(args.when_iso);
      if (Number.isNaN(dueAt.getTime())) {
        return result({ error: "Invalid ISO timestamp in when_iso" });
      }

      const reminders = await createReminder({
        targetPhone: resolved.contact.phone,
        text: args.message,
        dueAt: dueAt.toISOString(),
        sourceChatId: context.currentUserPhone,
        createdBy: context.currentUserPhone
      });
      const reminder = reminders[reminders.length - 1];
      return result({
        created: true,
        reminder
      });
    }

    case "list_reminders": {
      const resolved = await resolveTarget(args.target, context);
      if (resolved.status !== "resolved") {
        return result(resolved);
      }
      const reminders = await listReminders(resolved.contact.phone);
      return result({
        target: resolved.contact,
        reminders
      });
    }

    case "cancel_reminder": {
      await cancelReminder(args.reminder_id);
      return result({
        cancelled: true,
        reminder_id: args.reminder_id
      });
    }

    case "send_whatsapp_message": {
      const resolved = await resolveTarget(args.target, context);
      if (resolved.status !== "resolved") {
        return result(resolved);
      }

      const dedupeKey = outboundDedupKey(
        "tool-send",
        resolved.contact.phone,
        args.message,
        context.inboundMessageId
      );

      if (await hasRecentOutboundDedup(dedupeKey, 24 * 60 * 60 * 1000)) {
        return result({
          skipped: true,
          reason: "duplicate_send_prevented",
          target: resolved.contact
        });
      }

      const delivery = await sendWhatsAppTextChunked({
        to: resolved.contact.phone.replace(/^\+/, ""),
        body: args.message
      });

      await appendConversationMessage(resolved.contact.phone, {
        role: "assistant",
        text: args.message,
        meta: {
          source: "tool-send",
          requestedBy: context.currentUserPhone
        }
      });

      await rememberOutboundDedup(dedupeKey, {
        target: resolved.contact.phone,
        message: args.message,
        delivery
      });

      return result({
        sent: true,
        target: resolved.contact,
        delivery
      });
    }

    case "web_search": {
      const searchResult = await webSearch({
        query: args.query,
        maxResults: args.max_results,
        freshness: args.freshness === "any" ? "" : args.freshness || ""
      });
      return result(searchResult);
    }

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
