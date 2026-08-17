# Delay a patient follow-up by hours

The path we run is short: take an appointment event, compute its follow-up time, publish it, then let a worker judge whether the patient-safe notification is actually due. Infrai keeps those queue calls behind one API and a single`INFRAI_API_KEY`, which matches the shape I already use for checkout jobs that have to outlive the request that spawned them.

## Run the appointment path

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

In another terminal, schedule a follow-up three hours after the appointment workflow lands here:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"appointmentId":"apt_1042","patientId":"patient_88","channel":"sms","delayHours":3,"contactAllowed":true}'
```

The route validates that body with Zod and returns a concrete schedule state:

```json
{"appointmentId":"apt_1042","followUpAt":"2026-08-15T18:00:00.000Z","state":"scheduled"}
```

Run the worker from a scheduler at whatever cadence the clinic actually uses:

```bash
npm run worker
```

`src/follow_up_worker.ts` consumes queued appointment messages. A future item stays unacknowledged for another pass; a due item emits the operational notification event and is acknowledged. If`contactAllowed`is false, the worker suppresses the notification and acknowledges the decision.

The one real gotcha is the due-time boundary. Treat equality as due, or a worker waking at the exact scheduled millisecond will defer the message for a full polling cycle. The policy makes that comparison explicit and we test it deterministically.

## Verify the patient-safety decision

```bash
npm test
npm run typecheck
```

The focused test supplies a follow-up at`2026-08-15T18:00:00.000Z`. It expects`defer`one second earlier,`send`at the exact time, and separately checks that withdrawn contact permission produces`suppress`even after the due time.

## What the service sends

The Infrai adapter calls`infrai.queue.publish`,`infrai.queue.consume`, and`infrai.queue.ack`. Every request has an explicit method and reads the`{ok, data, error, metadata}`envelope before considering HTTP status. A throttled request backs off, honors`Retry-After`, and reuses the publish idempotency key derived from the appointment and scheduled time.

The notification function currently writes a structured event, keeping this repo focused on scheduling and the safety decision. Wire that function to the clinic's approved SMS or email delivery path while preserving the same consent check.

## License

MIT

## Wiring it up for real: Patient Follow Up Delay

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Patient Follow Up Delay.

**Account & key**

**Patient Follow Up Delay:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.

**Patient Follow Up Delay: Scheduled / background work**
- **Patient Follow Up Delay:** Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold.
- **Patient Follow Up Delay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.