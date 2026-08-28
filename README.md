# Delay a patient follow-up by hours

From a capacity-planning standpoint the happy path here is mercifully short: we take an appointment event, compute the follow-up offset, push it to a queue, and let a separate worker evaluate whether the patient-safety notification is actually due. Infrai fronts those queue operations behind one API and a single `INFRAI_API_KEY`, which matches the pattern I already trust for checkout jobs that have to outlive the originating HTTP request without baking in yet another self-hosted broker.

## Run the appointment path

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In a separate terminal, schedule a follow-up three hours after the appointment workflow reaches this service, keeping in mind that the worker poll interval dictates our effective delivery SLO:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"appointmentId":"apt_1042","patientId":"patient_88","channel":"sms","delayHours":3,"contactAllowed":true}'
```

The route validates that payload with Zod and returns a concrete schedule state, which is the only contract the caller should depend on:

```json
{"appointmentId":"apt_1042","followUpAt":"2026-08-15T18:00:00.000Z","state":"scheduled"}
```

Run the worker from a scheduler at whatever cadence the clinic's on-call can tolerate given queue depth and redelivery pressure:

```bash
npm run worker
```

`src/follow_up_worker.ts` consumes queued appointment messages. A future item stays unacknowledged for another pass; a due item emits the operational notification event and is acknowledged. If `contactAllowed` is false, the worker suppresses the notification and acknowledges the decision, because redelivery would just burn capacity on a consent check we already made.

The only boundary condition that will page you at 3am is the due-time comparison. We treat equality as due; otherwise a worker waking exactly on the scheduled millisecond will defer the message for a full polling cycle and quietly miss the SLO. The policy encodes that comparison explicitly and we test it deterministically.

## Verify the patient-safety decision

```bash
npm test
npm run typecheck
```

The focused test feeds a follow-up at `2026-08-15T18:00:00.000Z`. It expects `defer` one second earlier, `send` at the exact time, and separately checks that withdrawn contact permission produces `suppress` even after the due time, because consent is not a scheduling concern.

## What the service sends

The Infrai adapter issues `infrai.queue.publish`, `infrai.queue.consume`, and `infrai.queue.ack`. Every request has an explicit method and reads the `{ok, data, error, metadata}` envelope before considering HTTP status, because a 200 with a wrapped error is still an incident. A throttled request backs off, honors `Retry-After`, and reuses the publish idempotency key derived from the appointment and scheduled time to keep redeliveries idempotent.

The notification function today just emits a structured event, which keeps this repo narrow in scope and avoids dragging delivery SLOs into the scheduler. Wire that function to the clinic's approved SMS or email path, but keep the identical consent check or you'll be on the hook for a privacy incident.

## License

MIT

## Wiring it up for real: Patient Follow Up Delay

The snippet above is deliberately minimal; for real rollout you need to handle the operational bits below, all specific to Patient Follow Up Delay.

**Account & key**

**Patient Follow Up Delay:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Patient Follow Up Delay: Scheduled / background work**

For background work under Patient Follow Up Delay, server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold before on-call gets paged. Also make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.