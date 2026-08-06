import { expect, test } from "bun:test";

import {
  OperationalError,
  publicErrorSummary,
  RepositoryInvestigationError,
} from "../src/errors";

test("raw command output is never returned as a public incident summary", () => {
  const error = new OperationalError(
    "repository_check_failed",
    "A configured repository check failed. Human review is required.",
  );

  expect(publicErrorSummary(error)).toBe(
    "A configured repository check failed. Human review is required.",
  );
  expect(publicErrorSummary(new Error("secret command output"))).toBe(
    "Repository processing failed. Human review is required.",
  );
});

test("repository investigation errors retain only safe check status", () => {
  const error = new RepositoryInvestigationError(new Error("secret output"), [
    {
      command: ["bun", "test"],
      exitCode: 1,
      output: "DATABASE_URL=postgres://private@host",
    },
  ]);

  expect(error.checks).toEqual([{ command: ["bun", "test"], exitCode: 1 }]);
  expect(JSON.stringify(error.checks)).not.toContain("DATABASE_URL");
});
