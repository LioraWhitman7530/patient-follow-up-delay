import { followUpPayloadSchema, decideFollowUp } from "./follow_up_policy.js";
import { infrai } from "./infrai_queue.js";

async function sendOperationalNotification(
  appointmentId: string,
  patientId: string,
  channel: "sms" | "email",
): Promise<void> {
  console.log(JSON.stringify({ event: "follow_up_ready", appointmentId, patientId, channel }));
}

async function runOnce(): Promise<void> {
  const messages = await infrai.queue.consume(10, 300);
  for (const message of messages) {
    const payload = followUpPayloadSchema.parse(message.payload);
    const decision = decideFollowUp(payload, new Date());

    if (decision.action === "defer") {
      console.log(JSON.stringify({ event: "follow_up_deferred", appointmentId: payload.appointmentId }));
      continue;
    }
    if (decision.action === "send") {
      await sendOperationalNotification(payload.appointmentId, payload.patientId, payload.channel);
    }
    await infrai.queue.ack(message.message_id);
  }
}

await runOnce();
