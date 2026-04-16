import { config } from "./config.js";
import {
  appendConversationMessage,
  claimDueReminders,
  hasRecentOutboundDedup,
  markReminderFailed,
  markReminderSent,
  rememberOutboundDedup
} from "./store.js";
import { comparablePhone } from "./lib/phones.js";
import { outboundDedupKey, sendTextMessageChunked } from "./messaging.js";

export function startReminderLoop() {
  const timer = setInterval(async () => {
    const due = await claimDueReminders();
    for (const reminder of due) {
      const dedupeKey = outboundDedupKey(
        `reminder:${reminder.businessId || "default"}`,
        reminder.targetPhone,
        reminder.text,
        reminder.id
      );

      if (await hasRecentOutboundDedup(dedupeKey, 7 * 24 * 60 * 60 * 1000)) {
        await markReminderSent(reminder.id, { skipped: "duplicate_prevented" });
        continue;
      }

      try {
        const to = comparablePhone(reminder.targetPhone);
        if (!to || to.length < 7) {
          throw new Error("INVALID_PHONE");
        }

        const delivery = await sendTextMessageChunked({
          to,
          body: reminder.text,
          integration: reminder.integration || {}
        });
        await appendConversationMessage(reminder.targetPhone, {
          role: "assistant",
          text: reminder.text,
          meta: {
            source: "reminder",
            reminderId: reminder.id
          }
        }, {
          businessId: reminder.businessId || ""
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
