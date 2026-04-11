import { config } from "./config.js";
import {
  getDueReminders,
  hasRecentOutboundDedup,
  markReminderFailed,
  markReminderSent,
  rememberOutboundDedup
} from "./store.js";
import { outboundDedupKey, sendWhatsAppText } from "./whatsapp.js";

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
        const delivery = await sendWhatsAppText({
          to: reminder.targetPhone.replace(/^\+/, ""),
          body: reminder.text
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
