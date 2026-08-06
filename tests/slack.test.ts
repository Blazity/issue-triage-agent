import { expect, test } from "bun:test";

import {
  createFinalSlackMessage,
  createStartedSlackMessage,
} from "../src/slack";

const signal = {
  source: "zendesk",
  sourceAccount: "acme",
  sourceEventId: "42",
  routingKeys: ["checkout"],
  title: "Checkout is failing",
  description: "Customers cannot pay.",
  occurredAt: "2026-08-06T10:00:00.000Z",
  url: "https://acme.zendesk.com/tickets/42",
};

test("Slack lifecycle messages preserve source and workflow links", () => {
  const started = createStartedSlackMessage(
    signal,
    "https://vercel.com/acme/project/workflows/run-1",
  );
  const final = createFinalSlackMessage(
    signal,
    [
      {
        repositoryKey: "storefront",
        status: "pull_request_opened",
        summary: "The checkout failure was reproduced and repaired.",
        pullRequestUrl: "https://github.com/acme/storefront/pull/7",
        assessment: {
          verdict: "confirmed",
          severity: "high",
          owner: "Commerce Platform",
          reproductionSteps: ["Run the configured checkout test."],
          supportingEvidence: ["The checkout test failed before the change."],
          contradictingEvidence: [],
          recommendedNextAction: "Review the prepared pull request.",
        },
        checks: [{ command: ["bun", "test"], exitCode: 0 }],
      },
    ],
    "https://vercel.com/acme/project/workflows/run-1",
  );

  expect(JSON.stringify(started)).toContain(
    "https://acme.zendesk.com/tickets/42",
  );
  expect(JSON.stringify(started)).toContain(
    "https://vercel.com/acme/project/workflows/run-1",
  );
  expect(JSON.stringify(final)).toContain(
    "The checkout failure was reproduced and repaired.",
  );
  expect(JSON.stringify(final)).toContain(
    "https://github.com/acme/storefront/pull/7",
  );
  expect(JSON.stringify(final)).toContain("Commerce Platform");
  expect(JSON.stringify(final)).toContain("Review the prepared pull request");
  expect(JSON.stringify(final)).toContain("bun test: passed");
});

test("Slack final messages stay within Block Kit limits for maximum fan-out", () => {
  const longText = "x".repeat(2_000);
  const outcomes = Array.from({ length: 10 }, (_, index) => ({
    repositoryKey: `repository-${index}`,
    status: "notified" as const,
    summary: longText,
    assessment: {
      verdict: "inconclusive" as const,
      severity: "unknown" as const,
      owner: "Platform",
      reproductionSteps: Array(5).fill(longText),
      supportingEvidence: Array(5).fill(longText),
      contradictingEvidence: Array(5).fill(longText),
      recommendedNextAction: longText,
    },
    checks: Array.from({ length: 6 }, () => ({
      command: ["bun", longText],
      exitCode: 1,
    })),
  }));
  const message = createFinalSlackMessage(signal, outcomes);

  expect(message.blocks.length).toBeLessThanOrEqual(50);

  for (const block of message.blocks) {
    const text = (block.text as { text?: string } | undefined)?.text;
    if (text) expect(text.length).toBeLessThanOrEqual(3_000);
  }
});
