import { describe, expect, test } from "bun:test";

import { defineTriageConfig } from "../src/config";
import { executeIncident } from "../src/incident";
import type { IssueSignal } from "../src/domain";

const config = defineTriageConfig({
  configured: true,
  repositories: [
    {
      key: "storefront",
      owner: "Commerce",
      github: {
        owner: "acme",
        repository: "storefront",
        repositoryId: 101,
        installationId: 201,
        baseBranch: "main",
      },
      sandbox: { runtime: "node24", checks: [["bun", "test"]] },
    },
    {
      key: "checkout-api",
      owner: "Commerce API",
      github: {
        owner: "acme",
        repository: "checkout-api",
        repositoryId: 102,
        installationId: 201,
        baseBranch: "main",
      },
      sandbox: { runtime: "node24", checks: [["bun", "test"]] },
    },
  ],
  routes: [
    {
      source: "webhook",
      routingKey: "checkout",
      repositories: ["storefront", "checkout-api"],
    },
  ],
});

const signal: IssueSignal = {
  source: "webhook",
  sourceAccount: "acme",
  sourceEventId: "delivery-1",
  routingKeys: ["checkout"],
  title: "Checkout is failing",
  description: "Customers cannot pay.",
  occurredAt: "2026-08-06T10:00:00.000Z",
};

describe("executeIncident", () => {
  test("notifies one explicit handoff when no repository route matches", async () => {
    const notifications: string[][] = [];
    const result = await executeIncident(signal, [], {
      processRepository: async () => {
        throw new Error("No repository should be processed");
      },
      notify: async (_signal, outcomes) => {
        notifications.push(outcomes.map(({ summary }) => summary));
      },
    });

    expect(result.outcomes).toEqual([
      {
        repositoryKey: "unmapped",
        status: "notified",
        summary:
          "No configured repository route matched this issue. Human review is required.",
      },
    ]);
    expect(notifications).toEqual([
      [
        "No configured repository route matched this issue. Human review is required.",
      ],
    ]);
  });

  test("keeps repository outcomes independent and sends one final summary", async () => {
    const summaries: string[][] = [];
    const result = await executeIncident(signal, config.repositories, {
      processRepository: async (_signal, repository) => {
        if (repository.key === "checkout-api") {
          throw new Error("Repository checks failed");
        }

        return {
          repositoryKey: repository.key,
          status: "pull_request_opened" as const,
          summary: "A verified repair passed repository checks.",
          pullRequestUrl: "https://github.com/acme/storefront/pull/7",
        };
      },
      notify: async (_signal, outcomes) => {
        summaries.push(outcomes.map(({ status }) => status));
      },
    });

    expect(result.outcomes).toEqual([
      {
        repositoryKey: "storefront",
        status: "pull_request_opened",
        summary: "A verified repair passed repository checks.",
        pullRequestUrl: "https://github.com/acme/storefront/pull/7",
      },
      {
        repositoryKey: "checkout-api",
        status: "failed",
        summary: "Repository processing failed. Human review is required.",
      },
    ]);
    expect(summaries).toEqual([["pull_request_opened", "failed"]]);
  });
});
