import { config } from "./config.js";
import {
  appendConversationMessage,
  getDueReminders,
  hasRecentOutboundDedup,
  markReminderFailed,
  markReminderSent,
  rememberOutboundDedup
} from "./store.js";
import { outboundDedupKey, sendWhatsAppTextChunked } from "./whatsapp.js";

export function startReminderLoop() {
  const timer = setInterval(async () => {
    const due = await getDueReminders();
    for (const reminder of due) {
      const dedupeKey = outboundDedupKey(
        "reminder",
        reminder.targetPhone,
        reminder.text,
        reminder.id
      );

      if (await hasRecentOutboundDedup(dedupeKey, 7 * 24 * 60 * 60 * 1000)) {
        await markReminderSent(reminder.id, { skipped: "duplicate_prevented" });
        continue;
      }

      try {
        const delivery = await sendWhatsAppTextChunked({
          to: reminder.targetPhone.replace(/^\+/, ""),
          body: reminder.text
        });
        await appendConversationMessage(reminder.targetPhone, {
          role: "assistant",
          text: reminder.text,
          meta: {
            source: "reminder",
            reminderId: reminder.id
          }
        });
        await rememberOutboundDedup(dedupeKey, {
          reminderId: reminder.id,
          delivery
        });
        await markReminderSent(reminder.id, delivery);
      } catch (error) {
        await markReminderFailed(reminder.id, error.message);
      }
    }
  }, config.reminderPollIntervalMs);

  return () => clearInterval(timer);
}
