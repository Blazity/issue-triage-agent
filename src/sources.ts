import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { IssueSignal } from "./domain";

type SignatureInput = {
  rawBody: string;
  signature: string;
  timestamp: string;
  secret: string;
  now: Date;
  format: "generic" | "zendesk";
};

export function verifyHmacSignature(input: SignatureInput) {
  const timestamp = new Date(input.timestamp);

  if (
    Number.isNaN(timestamp.getTime()) ||
    Math.abs(input.now.getTime() - timestamp.getTime()) > 5 * 60 * 1_000
  ) {
    return false;
  }

  const signedValue =
    input.format === "zendesk"
      ? `${input.timestamp}${input.rawBody}`
      : `${input.timestamp}.${input.rawBody}`;
  const expected = createHmac("sha256", input.secret)
    .update(signedValue)
    .digest();

  let received: Buffer;

  try {
    received = Buffer.from(input.signature, "base64");
  } catch {
    return false;
  }

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

const genericWebhookSchema = z.object({
  account: z.string().min(1).max(200),
  eventId: z.string().min(1).max(200),
  route: z.union([
    z.string().min(1).max(100),
    z.array(z.string().min(1).max(100)).max(10),
  ]),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(20_000),
  occurredAt: z.iso.datetime(),
  url: z.url().optional(),
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
  origin: z
    .object({
      actor: z.string().min(1).max(200).optional(),
      generatedBy: z.string().min(1).max(200).optional(),
      runDepth: z.number().int().nonnegative().max(10).optional(),
    })
    .optional(),
});

export function normalizeGenericWebhook(input: unknown): IssueSignal {
  const payload = genericWebhookSchema.parse(input);

  return {
    source: "webhook",
    sourceAccount: payload.account,
    sourceEventId: payload.eventId,
    routingKeys: Array.isArray(payload.route) ? payload.route : [payload.route],
    title: payload.title,
    description: payload.description,
    occurredAt: payload.occurredAt,
    url: payload.url,
    metadata: payload.metadata,
    origin: payload.origin,
  };
}

const zendeskWebhookSchema = z.object({
  account: z.string().min(1).max(200),
  id: z.union([z.string().min(1), z.number().int().nonnegative()]),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(100)).max(100).nullable().optional(),
  priority: z.string().max(30).nullable().optional(),
  createdAt: z.iso.datetime(),
  url: z.url().optional(),
});

export function normalizeZendeskWebhook(input: unknown): IssueSignal {
  const payload = zendeskWebhookSchema.parse(input);
  const priority = payload.priority?.toLocaleLowerCase();
  const routingKeys = (payload.tags ?? []).map((tag) =>
    tag.toLocaleLowerCase(),
  );

  if (priority) {
    routingKeys.push(`priority:${priority}`);
  }

  return {
    source: "zendesk",
    sourceAccount: payload.account,
    sourceEventId: String(payload.id),
    routingKeys,
    title: payload.title,
    description: payload.description,
    occurredAt: payload.createdAt,
    url: payload.url,
    metadata: priority ? { priority } : undefined,
  };
}
