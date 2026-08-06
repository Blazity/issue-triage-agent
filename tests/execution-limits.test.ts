import { expect, test } from "bun:test";

import { createInMemoryAdmissionStore } from "../src/admission";

test("enforces fenced repository concurrency and idempotent pull-request budgets by physical repository", async () => {
  const store = createInMemoryAdmissionStore();
  const expiresAt = new Date("2099-08-06T10:10:00.000Z");
  const repositoryIdentity = "201:101";

  const firstToken = await store.claimRepositoryLease(
    repositoryIdentity,
    "storefront",
    "signal-1",
    "workflow-1",
    3,
    expiresAt,
    expiresAt,
  );
  expect(firstToken).toBeString();
  expect(
    await store.claimRepositoryLease(
      repositoryIdentity,
      "storefront-alias",
      "signal-2",
      "workflow-2",
      3,
      expiresAt,
      expiresAt,
    ),
  ).toBeNull();
  expect(
    await store.claimRepositoryLease(
      repositoryIdentity,
      "storefront-alias",
      "signal-1",
      "workflow-2",
      3,
      expiresAt,
      expiresAt,
    ),
  ).toBeNull();
  expect(
    await store.renewRepositoryLease(
      repositoryIdentity,
      "signal-1",
      "workflow-1",
      "stale-token",
      expiresAt,
    ),
  ).toBe(false);
  expect(
    await store.renewRepositoryLease(
      repositoryIdentity,
      "signal-1",
      "workflow-1",
      firstToken!,
      expiresAt,
    ),
  ).toBe(true);
  const outcome = {
    repositoryKey: "storefront",
    status: "notified" as const,
    summary: "Human review is required.",
  };
  expect(
    await store.advanceRepositoryRun(
      "signal-1",
      repositoryIdentity,
      "workflow-2",
      firstToken!,
      { stage: "completed", outcome },
    ),
  ).toBe(false);
  expect(
    await store.advanceRepositoryRun(
      "signal-1",
      repositoryIdentity,
      "workflow-1",
      firstToken!,
      { stage: "completed", outcome },
    ),
  ).toBe(true);
  expect(
    await store.getRepositoryRun("signal-1", repositoryIdentity),
  ).toMatchObject({ stage: "completed", outcome });
  expect(
    await store.claimPullRequestBudget(
      repositoryIdentity,
      "signal-1",
      1,
      new Date("2026-08-06T10:00:00.000Z"),
    ),
  ).toBe(true);
  expect(
    await store.claimPullRequestBudget(
      repositoryIdentity,
      "signal-1",
      1,
      new Date("2026-08-06T10:00:00.000Z"),
    ),
  ).toBe(true);
  expect(
    await store.claimPullRequestBudget(
      repositoryIdentity,
      "signal-2",
      1,
      new Date("2026-08-06T10:00:00.000Z"),
    ),
  ).toBe(false);
});
