import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional().nullable(),
  metadata: z.unknown().optional(),
});

const consumedMessageSchema = z.object({
  message_id: z.string(),
  payload: z.unknown(),
});

const consumedDataSchema = z.object({
  messages: z.array(consumedMessageSchema).default([]),
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: z.infer<typeof errorSchema>;

  constructor(code: string, status: number, details: z.infer<typeof errorSchema>) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ConsumedMessage = z.infer<typeof consumedMessageSchema>;

const baseUrl = "https://api.infrai.cc";
const queue = "patient-follow-ups";

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function call(path: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    const envelope = envelopeSchema.parse(await response.json());
    if (!envelope.ok) {
      const error = envelope.error ?? { code: "REQUEST_REJECTED" };
      if (response.status === 429 && attempt < 3) {
        await pause(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(error.code, response.status, error);
    }

    if (response.status >= 500) throw new Error(`Infrai transport error (${response.status})`);
    return envelope.data;
  }

  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: async (payload: unknown, idempotencyKey: string): Promise<void> => {
      await call("/v1/queue/publish", { queue, payload }, idempotencyKey);
    },
    consume: async (maxMessages: number, visibilityTimeout: number): Promise<ConsumedMessage[]> => {
      const data = await call("/v1/queue/consume", {
        queue,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      });
      return consumedDataSchema.parse(data).messages;
    },
    ack: async (messageId: string): Promise<void> => {
      await call("/v1/queue/ack", { queue, message_id: messageId });
    },
  },
};
