import { describe, expect, test } from "bun:test";

import { defineTriageConfig, resolveRepositories } from "../src/config";
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
      source: "zendesk",
      routingKey: "checkout",
      repositories: ["storefront", "checkout-api"],
    },
  ],
});

const signal: IssueSignal = {
  source: "zendesk",
  sourceAccount: "acme-support",
  sourceEventId: "event-42",
  routingKeys: ["checkout"],
  title: "Checkout fails after applying a discount",
  description: "Customers cannot complete payment.",
  occurredAt: "2026-08-06T10:00:00.000Z",
};

describe("resolveRepositories", () => {
  test("maps one trusted issue signal to independent configured repositories", () => {
    expect(resolveRepositories(signal, config).map(({ key }) => key)).toEqual([
      "storefront",
      "checkout-api",
    ]);
  });

  test("rejects a route that exceeds the deployment fan-out ceiling", () => {
    const constrained = defineTriageConfig({
      ...config,
      limits: { maximumRepositoriesPerIncident: 1 },
    });

    expect(() => resolveRepositories(signal, constrained)).toThrow(
      "exceeds maximumRepositoriesPerIncident",
    );
  });

  test("rejects aliases for the same physical GitHub repository", () => {
    expect(() =>
      defineTriageConfig({
        configured: true,
        repositories: [
          config.repositories[0],
          { ...config.repositories[0], key: "storefront-alias" },
        ],
        routes: [
          {
            source: "zendesk",
            routingKey: "checkout",
            repositories: ["storefront"],
          },
        ],
      }),
    ).toThrow("GitHub repository identities must be unique");
  });

  test("rejects copied repository placeholders in an enabled configuration", () => {
    expect(() =>
      defineTriageConfig({
        configured: true,
        repositories: [
          {
            ...config.repositories[0],
            github: {
              ...config.repositories[0].github,
              owner: "your-organization",
              repository: "your-web-app",
            },
          },
        ],
        routes: [{ ...config.routes[0], repositories: ["storefront"] }],
      }),
    ).toThrow("GitHub owner and repository placeholders must be replaced");
  });
});
