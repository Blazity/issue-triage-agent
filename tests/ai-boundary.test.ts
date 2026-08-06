import { describe, expect, test } from "bun:test";

import {
  gatewayDataPolicy,
  modelIssueContext,
  redactForModel,
  sanitizeCheckForModel,
} from "../src/ai-boundary";
import { defineTriageConfig } from "../src/config";
import type { IssueSignal } from "../src/domain";

const signal: IssueSignal = {
  source: "webhook",
  sourceAccount: "acme",
  sourceEventId: "event-1",
  routingKeys: ["checkout"],
  title: "Checkout failed for buyer@example.com",
  description:
    "Authorization: Bearer secret-token and DATABASE_URL=postgres://admin:password@db.internal/app",
  occurredAt: "2026-08-10T10:00:00.000Z",
  metadata: {
    priority: "urgent for operator@example.com",
    environment: "production",
    customerEmail: "customer@example.com",
    accessToken: "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
    attempts: 12,
  },
};

describe("AI data boundary", () => {
  test("redacts common secrets and personal email addresses", () => {
    const value = redactForModel(
      [
        "contact=user@example.com",
        "Authorization: Bearer bearer-secret",
        "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
        "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      ].join("\n"),
    );

    expect(value).not.toContain("user@example.com");
    expect(value).not.toContain("bearer-secret");
    expect(value).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(value).not.toContain("private-material");
    expect(value).toContain("[REDACTED_EMAIL]");
    expect(value).toContain("[REDACTED_SECRET]");
  });

  test("only includes explicitly allowlisted metadata", () => {
    const context = modelIssueContext(signal, ["priority", "attempts"]);
    const serialized = JSON.stringify(context);

    expect(context.metadata).toEqual({
      priority: "urgent for [REDACTED_EMAIL]",
      attempts: 12,
    });
    expect(serialized).not.toContain("customerEmail");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("buyer@example.com");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("postgres://");
  });

  test("redacts check evidence without changing its status", () => {
    expect(
      sanitizeCheckForModel({
        command: ["bun", "test"],
        exitCode: 1,
        output: "Slack token: xoxb-1234567890-secret",
      }),
    ).toEqual({
      command: ["bun", "test"],
      exitCode: 1,
      output: "Slack token: [REDACTED_SECRET]",
    });
  });

  test("enforces Gateway retention and training controls", () => {
    expect(gatewayDataPolicy).toEqual({
      gateway: {
        zeroDataRetention: true,
        disallowPromptTraining: true,
        tags: ["feature:issue-triage"],
      },
    });
  });

  test("metadata access is denied by default and bounded when configured", () => {
    const configured = defineTriageConfig({
      configured: true,
      repositories: [
        {
          key: "web",
          owner: "Platform",
          github: {
            owner: "acme",
            repository: "web",
            repositoryId: 1,
            installationId: 1,
          },
          sandbox: { checks: [["bun", "test"]] },
        },
        {
          key: "api",
          owner: "Platform",
          github: {
            owner: "acme",
            repository: "api",
            repositoryId: 2,
            installationId: 1,
          },
          sandbox: { checks: [["bun", "test"]] },
          policy: { modelMetadataKeys: ["priority", "environment"] },
        },
      ],
      routes: [
        {
          source: "webhook",
          routingKey: "checkout",
          repositories: ["web", "api"],
        },
      ],
    });

    expect(configured.repositories[0]?.policy.modelMetadataKeys).toEqual([]);
    expect(configured.repositories[1]?.policy.modelMetadataKeys).toEqual([
      "priority",
      "environment",
    ]);
  });
});
