import { expect, test } from "bun:test";

import {
  collectRepositoryOutcomes,
  RepositoryOwnershipConflict,
  resolveIncidentDeadline,
} from "../src/workflow";

test("one rejected repository does not discard independent outcomes", () => {
  expect(
    collectRepositoryOutcomes(
      ["storefront", "api"],
      [
        {
          status: "fulfilled",
          value: {
            repositoryKey: "storefront",
            status: "notified",
            summary: "Human review is required.",
          },
        },
        { status: "rejected", reason: new Error("secret output") },
      ],
    ),
  ).toEqual([
    {
      repositoryKey: "storefront",
      status: "notified",
      summary: "Human review is required.",
    },
    {
      repositoryKey: "api",
      status: "failed",
      summary: "Repository processing failed. Human review is required.",
    },
  ]);
});

test("a duplicate workflow owner aborts without replacing the original notification", () => {
  expect(() =>
    collectRepositoryOutcomes(
      ["storefront"],
      [{ status: "rejected", reason: new RepositoryOwnershipConflict() }],
    ),
  ).toThrow("already owned by another workflow");
});

test("a takeover gets one fresh bounded recovery window", () => {
  const firstDeadline = resolveIncidentDeadline(
    "2026-08-07T10:00:00.000Z",
    600,
  );
  const recoveryDeadline = resolveIncidentDeadline(firstDeadline, 600);

  expect(firstDeadline).toBe("2026-08-07T10:10:00.000Z");
  expect(recoveryDeadline).toBe("2026-08-07T10:20:00.000Z");
});
