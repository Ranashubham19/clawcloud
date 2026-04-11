import {
  cancelReminder,
  createReminder,
  getConversation,
  listContacts,
  listReminders,
  rememberOutboundDedup,
  resolveContact,
  hasRecentOutboundDedup,
  upsertContact
} from "./store.js";
import { normalizePhone } from "./lib/phones.js";
import { sendWhatsAppText, outboundDedupKey } from "./whatsapp.js";

export const toolDefinitions = [
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

      const delivery = await sendWhatsAppText({
        to: resolved.contact.phone.replace(/^\+/, ""),
        body: args.message
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

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
