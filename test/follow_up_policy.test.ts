import assert from "node:assert/strict";
import test from "node:test";
import { decideFollowUp } from "../src/follow_up_policy.js";

test("defers an allowed follow-up until its scheduled hour", () => {
  const payload = {
    appointmentId: "apt_1042",
    patientId: "patient_88",
    channel: "sms" as const,
    followUpAt: "2026-08-15T18:00:00.000Z",
    contactAllowed: true,
  };

  assert.equal(decideFollowUp(payload, new Date("2026-08-15T17:59:59.000Z")).action, "defer");
  assert.equal(decideFollowUp(payload, new Date("2026-08-15T18:00:00.000Z")).action, "send");
});

test("suppresses a due notification when contact is not allowed", () => {
  const decision = decideFollowUp({
    appointmentId: "apt_1042",
    patientId: "patient_88",
    channel: "email",
    followUpAt: "2026-08-15T18:00:00.000Z",
    contactAllowed: false,
  }, new Date("2026-08-15T19:00:00.000Z"));

  assert.equal(decision.action, "suppress");
});
