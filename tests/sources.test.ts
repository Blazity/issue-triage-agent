import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  normalizeGenericWebhook,
  normalizeZendeskWebhook,
  verifyHmacSignature,
} from "../src/sources";

describe("issue source adapters", () => {
  test("verifies a fresh generic webhook without trusting body-provided secrets", () => {
    const body = JSON.stringify({ sourceEventId: "delivery-1" });
    const timestamp = "2026-08-06T10:00:00.000Z";
    const signature = createHmac("sha256", "secret")
      .update(`${timestamp}.${body}`)
      .digest("base64");

    expect(
      verifyHmacSignature({
        rawBody: body,
        signature,
        timestamp,
        secret: "secret",
        now: new Date("2026-08-06T10:04:59.000Z"),
        format: "generic",
      }),
    ).toBe(true);
  });

  test("normalizes a canonical webhook into an issue signal", () => {
    expect(
      normalizeGenericWebhook({
        account: "acme",
        eventId: "delivery-1",
        route: "checkout",
        title: "Checkout is failing",
        description: "Customers cannot pay.",
        occurredAt: "2026-08-06T10:00:00.000Z",
      }),
    ).toMatchObject({
      source: "webhook",
      sourceAccount: "acme",
      sourceEventId: "delivery-1",
      routingKeys: ["checkout"],
    });
  });

  test("normalizes nullable Zendesk tags and priority casing", () => {
    expect(
      normalizeZendeskWebhook({
        account: "acme-support",
        id: 42,
        title: "Checkout is failing",
        description: "Customers cannot pay.",
        tags: null,
        priority: "URGENT",
        createdAt: "2026-08-06T10:00:00.000Z",
      }),
    ).toMatchObject({
      source: "zendesk",
      sourceEventId: "42",
      routingKeys: ["priority:urgent"],
    });
  });

  test("preserves trusted recursion metadata from a signed webhook", () => {
    expect(
      normalizeGenericWebhook({
        account: "acme",
        eventId: "delivery-2",
        route: "checkout",
        title: "Checkout is failing",
        description: "Customers cannot pay.",
        occurredAt: "2026-08-06T10:00:00.000Z",
        origin: {
          actor: "automation",
          generatedBy: "issue-triage-agent",
          runDepth: 1,
        },
      }),
    ).toMatchObject({
      origin: {
        actor: "automation",
        generatedBy: "issue-triage-agent",
        runDepth: 1,
      },
    });
  });
});
