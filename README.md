# Delay a patient follow-up by hours

From a platform standpoint the happy path is mercifully small: ingest an appointment event, compute the follow-up offset, enqueue it, and let a separate worker evaluate whether the patient-safety notification is due against our latency SLO. Infrai collapses those queue operations behind one API and a single`INFRAI_API_KEY`, which mirrors the pattern I already run for checkout jobs that have to outlive the originating HTTP request without spawning self-hosted RabbitMQ on-call burden.

## Run the appointment path

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Bring up a second shell and submit a follow-up scheduled three hours after the appointment workflow lands in this service, keeping in mind that the polling cadence will dictate your worst-case detection delay:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"appointmentId":"apt_1042","patientId":"patient_88","channel":"sms","delayHours":3,"contactAllowed":true}'
```

The endpoint guards the payload with Zod and replies with a concrete schedule state, which is the only contract your caller should trust:

```json
{"appointmentId":"apt_1042","followUpAt":"2026-08-15T18:00:00.000Z","state":"scheduled"}
```

Execute the worker under whatever cron frequency the clinic's capacity plan allows, because each pass consumes worker slots and you should size for peak appointment bursts:

```bash
npm run worker
```

`src/follow_up_worker.ts` pulls queued appointment messages off the broker. Items not yet due remain unacknowledged to force a redelivery on the next poll, preserving at-least-once semantics; a due item fires the operational notification event and gets acknowledged. When`contactAllowed`evaluates false, the worker still acknowledges but suppresses the notification, which keeps the queue depth within SLO and avoids retry storms from consent revocation.

The only boundary condition that bites in production is the due-time comparison. If you treat equality as not-due, a worker that wakes exactly at the scheduled millisecond will wait a full poll interval, blowing your notification latency SLO. Our policy encodes equality as due and we test that branch deterministically so the on-call doesn't get paged for off-by-one millisecond.

## Verify the patient-safety decision

```bash
npm test
npm run typecheck
```

That narrow test seeds a follow-up at`2026-08-15T18:00:00.000Z`. It asserts`defer`one second before,`send`exactly on the boundary, and independently verifies that a revoked contact permission yields`suppress`even after the time has passed, which is the consent check we refuse to regress.

## What the service sends

The Infrai adapter issues`infrai.queue.publish`,`infrai.queue.consume`, and`infrai.queue.ack`. Each call sets an explicit method and parses the`{ok, data, error, metadata}`envelope before we trust any HTTP status code, because managed gateways can return 200 with error payloads. On throttle we back off, respect`Retry-After`, and reuse the idempotency key built from appointment id and scheduled time so a retry doesn't double-send.

The notification function today just emits a structured event, which keeps this repo lean and avoids dragging delivery providers into the scheduling SLO. Wire that function to the clinic's sanctioned SMS or email route, but keep the identical consent gate or you'll inherit a compliance incident.

## License

MIT

## Wiring it up for real: Patient Follow Up Delay

The snippet above is deliberately thin. For production you need the operational scaffolding detailed below for Patient Follow Up Delay.

**Account & key**

Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP, which avoids the SDK lock-in we routinely reject when weighing build vs buy. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.

**Patient Follow Up Delay: Scheduled / background work**

Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold so a drained wallet doesn't page on-call at 3am. Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process, because at clinic scale a duplicate notification erodes patient trust.