import { defineTriageConfig, resolveRepositories } from "../src/config";
import type { IssueSignal } from "../src/domain";
import { executeIncident } from "../src/incident";

const config = defineTriageConfig({
  configured: true,
  repositories: [
    {
      key: "demo-storefront",
      owner: "Demo Commerce Team",
      github: {
        owner: "example",
        repository: "storefront",
        repositoryId: 1,
        installationId: 1,
        baseBranch: "main",
      },
      sandbox: { checks: [["bun", "test"]] },
    },
  ],
  routes: [
    {
      source: "webhook",
      routingKey: "checkout",
      repositories: ["demo-storefront"],
    },
  ],
});

const signal: IssueSignal = {
  source: "webhook",
  sourceAccount: "local-demo",
  sourceEventId: "demo-incident-1",
  routingKeys: ["checkout"],
  title: "Customers cannot complete checkout",
  description: "Checkout attempts fail after the latest release.",
  occurredAt: "2026-01-01T00:00:00.000Z",
  url: "https://example.com/incidents/demo-incident-1",
};

const repositories = resolveRepositories(signal, config);
const result = await executeIncident(signal, repositories, {
  async processRepository(_signal, repository) {
    return {
      repositoryKey: repository.key,
      status: "notified",
      summary:
        "Demo mode: repository routed independently; external investigation skipped.",
    };
  },
  async notify(_signal, outcomes) {
    console.log(
      `Would notify a reviewer about ${outcomes.length} repository outcomes.`,
    );
  },
});

console.log(
  JSON.stringify(
    { signal, repositories: repositories.map(({ key }) => key), ...result },
    null,
    2,
  ),
);
