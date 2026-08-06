import { describe, expect, test } from "bun:test";

import { defineTriageConfig } from "../src/config";
import {
  evaluateRepositoryAction,
  filterModelReadablePaths,
  isPathEligibleForModelAccess,
} from "../src/policy";

const repository = defineTriageConfig({
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
  ],
  routes: [
    { source: "webhook", routingKey: "checkout", repositories: ["storefront"] },
  ],
}).repositories[0];

const safeResult = {
  investigation: {
    reproduced: true,
    confidence: "high" as const,
    summary: "Checkout rejects valid discount codes.",
    verdict: "confirmed" as const,
    severity: "high" as const,
    owner: "Commerce Platform",
    reproductionSteps: ["Run the configured checkout check."],
    supportingEvidence: [
      "The repository test reproduces the reported checkout failure.",
    ],
    contradictingEvidence: [],
    recommendedNextAction: "Review the prepared repair.",
  },
  repair: {
    summary: "Restore the expected discount calculation.",
    baseSha: "abc123",
    digest: "candidate-digest",
    files: [
      {
        path: "src/discount.ts",
        content: "export const discount = 0.2;\n",
        mode: "100644" as const,
      },
    ],
    checks: [{ command: ["bun", "test"], exitCode: 0, output: "12 pass" }],
  },
  checks: [{ command: ["bun", "test"], exitCode: 0, output: "12 pass" }],
};

describe("evaluateRepositoryAction", () => {
  test("does not impose file-count or changed-line limits on a verified repair", () => {
    const result = {
      ...safeResult,
      repair: {
        ...safeResult.repair,
        files: Array.from({ length: 25 }, (_, index) => ({
          path: `src/repair-${index}.ts`,
          content: `export const repair${index} = true;\n`,
          mode: "100644" as const,
        })),
      },
    };

    expect(evaluateRepositoryAction(repository, result)).toEqual({
      action: "open_draft_pr",
      reason: "verified_repair",
    });
  });

  test("opens a draft pull request only for a verified repair", () => {
    expect(evaluateRepositoryAction(repository, safeResult)).toEqual({
      action: "open_draft_pr",
      reason: "verified_repair",
    });
  });

  test("does not automate a change to a protected path", () => {
    const result = {
      ...safeResult,
      repair: {
        ...safeResult.repair,
        files: [
          {
            path: "package.json",
            content: "{}",
            mode: "100644" as const,
          },
        ],
      },
    };

    expect(evaluateRepositoryAction(repository, result)).toEqual({
      action: "notify",
      reason: "blocked_path",
    });
  });

  test("does not disclose blocked repository paths to the model", () => {
    expect(isPathEligibleForModelAccess(repository, "src/discount.ts")).toBe(
      true,
    );
    expect(isPathEligibleForModelAccess(repository, ".env.production")).toBe(
      false,
    );
    expect(isPathEligibleForModelAccess(repository, "src/auth/token.ts")).toBe(
      false,
    );
    expect(
      filterModelReadablePaths(repository, [
        "src/discount.ts",
        ".env.production",
        "src/auth/token.ts",
      ]),
    ).toEqual(["src/discount.ts"]);
  });

  test("does not automate an unverified diagnosis", () => {
    const result = {
      ...safeResult,
      investigation: {
        ...safeResult.investigation,
        confidence: "low" as const,
      },
    };

    expect(evaluateRepositoryAction(repository, result)).toEqual({
      action: "notify",
      reason: "insufficient_confidence",
    });
  });
});
