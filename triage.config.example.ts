import { defineTriageConfig } from "./src/config";

export default defineTriageConfig({
  configured: true,
  version: "1",
  repositories: [
    {
      key: "storefront",
      owner: "Checkout Experience",
      github: {
        owner: "acme-commerce",
        repository: "storefront",
        // Stable numeric bindings prevent a renamed or recreated repository from inheriting access.
        repositoryId: 100001,
        // One GitHub App installation can cover several explicitly selected repositories.
        installationId: 200001,
        baseBranch: "main",
      },
      sandbox: {
        runtime: "node24",
        bootstrap: [
          ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
        ],
        checks: [["bun", "test"]],
        allowedEgress: ["registry.npmjs.org", "*.npmjs.org"],
      },
      policy: {
        pullRequestMode: "draft",
        allowedPaths: ["src/**", "tests/**"],
        allowPublicPullRequests: false,
        includeIssueContextInPullRequest: false,
        modelMetadataKeys: ["priority", "environment"],
      },
    },
    {
      key: "checkout-api",
      owner: "Payments Platform",
      github: {
        owner: "acme-commerce",
        repository: "checkout-api",
        repositoryId: 100002,
        installationId: 200001,
        baseBranch: "main",
      },
      sandbox: {
        runtime: "node24",
        bootstrap: [
          ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
        ],
        checks: [["bun", "test"]],
        allowedEgress: ["registry.npmjs.org", "*.npmjs.org"],
      },
      policy: {
        pullRequestMode: "draft",
        allowedPaths: ["src/**", "tests/**"],
        allowPublicPullRequests: false,
        includeIssueContextInPullRequest: false,
        modelMetadataKeys: ["priority", "environment"],
      },
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
