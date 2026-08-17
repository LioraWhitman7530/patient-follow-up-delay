import { z } from "zod";

export const followUpPayloadSchema = z.object({
  appointmentId: z.string().min(1),
  patientId: z.string().min(1),
  channel: z.enum(["sms", "email"]),
  followUpAt: z.string().datetime(),
  contactAllowed: z.boolean(),
});

export type FollowUpPayload = z.infer<typeof followUpPayloadSchema>;

export type FollowUpDecision =
  | { action: "send"; payload: FollowUpPayload }
  | { action: "defer"; payload: FollowUpPayload }
  | { action: "suppress"; payload: FollowUpPayload };

export function decideFollowUp(payload: FollowUpPayload, now: Date): FollowUpDecision {
  if (!payload.contactAllowed) {
    return { action: "suppress", payload };
  }

  if (Date.parse(payload.followUpAt) > now.getTime()) {
    return { action: "defer", payload };
  }

  return { action: "send", payload };
}
