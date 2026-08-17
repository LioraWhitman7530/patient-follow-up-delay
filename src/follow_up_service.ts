import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai_queue.js";

const requestSchema = z.object({
  appointmentId: z.string().min(1),
  patientId: z.string().min(1),
  channel: z.enum(["sms", "email"]),
  delayHours: z.number().int().min(1).max(168),
  contactAllowed: z.boolean(),
});

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/follow-ups") {
    response.writeHead(404).end();
    return;
  }

  try {
    const input = requestSchema.parse(await readJson(request));
    const followUpAt = new Date(Date.now() + input.delayHours * 3_600_000).toISOString();
    const payload = {
      appointmentId: input.appointmentId,
      patientId: input.patientId,
      channel: input.channel,
      followUpAt,
      contactAllowed: input.contactAllowed,
    };
    const idempotencyKey = createHash("sha256")
      .update(`${input.appointmentId}:${followUpAt}`)
      .digest("hex");

    await infrai.queue.publish(payload, idempotencyKey);
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ appointmentId: input.appointmentId, followUpAt, state: "scheduled" }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_request", issues: error.issues }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    response.writeHead(500).end();
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Follow-up service listening on http://localhost:${port}`));
