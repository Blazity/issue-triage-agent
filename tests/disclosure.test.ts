import { expect, test } from "bun:test";

import { defineTriageConfig } from "../src/config";
import {
  assertExpectedBranchCommit,
  assertExpectedPullRequest,
  pullRequestDisclosure,
} from "../src/disclosure";
import type { IssueSignal, Repair } from "../src/domain";

const signal: IssueSignal = {
  source: "zendesk",
  sourceAccount: "acme",
  sourceEventId: "ticket-42",
  routingKeys: ["checkout"],
  title: "Customer Jane Doe cannot pay",
  description: "Jane's private account details are in ticket 42.",
  occurredAt: "2026-08-07T10:00:00.000Z",
  url: "https://acme.zendesk.com/agent/tickets/42",
};

const repair: Repair = {
  summary: "Jane's checkout failed because of private account state.",
  baseSha: "base-sha",
  digest: "candidate-digest",
  files: [
    {
      path: "src/checkout.ts",
      content: "fixed\n",
      mode: "100755" as const,
    },
  ],
  checks: [{ command: ["bun", "test"], exitCode: 0, output: "secret" }],
};

test("default pull-request disclosure omits support-ticket and customer context", () => {
  const disclosure = pullRequestDisclosure(signal, repair, false);
  const serialized = JSON.stringify(disclosure);

  expect(disclosure.title).toBe("Automated issue triage repair");
  expect(serialized).not.toContain("Jane");
  expect(serialized).not.toContain("zendesk.com");
  expect(serialized).not.toContain("secret");
  expect(disclosure.body).toContain("bun test: passed");
});

test("public repository publishing and source disclosure require explicit opt-in", () => {
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
        sandbox: { checks: [["bun", "test"]] },
      },
    ],
    routes: [
      {
        source: "zendesk",
        routingKey: "checkout",
        repositories: ["storefront"],
      },
    ],
  });

  expect(config.repositories[0].policy.allowPublicPullRequests).toBe(false);
  expect(config.repositories[0].policy.includeIssueContextInPullRequest).toBe(
    false,
  );
});

test("rejects reconciliation with any unexpected branch commit", () => {
  expect(() =>
    assertExpectedBranchCommit("unrelated-commit", "expected-commit"),
  ).toThrow("deterministic triage branch does not match");
});

test("rejects an existing pull request aimed at another base or commit", () => {
  expect(() =>
    assertExpectedPullRequest(
      { headSha: "expected", baseRef: "release", draft: true },
      { headSha: "expected", baseRef: "main", draft: true },
    ),
  ).toThrow("pull request does not match");
  expect(() =>
    assertExpectedPullRequest(
      { headSha: "unrelated", baseRef: "main", draft: true },
      { headSha: "expected", baseRef: "main", draft: true },
    ),
  ).toThrow("pull request does not match");
});
