import { expect, test } from "bun:test";

import {
  assertCandidateUnchanged,
  recordCheckBeforeMutationStop,
  repairDigest,
} from "../src/repository-agent";

const files = [
  {
    path: "src/a.ts",
    content: "export const a = 1;\n",
    mode: "100644" as const,
  },
  {
    path: "src/b.ts",
    content: "export const b = 2;\n",
    mode: "100644" as const,
  },
];

test("candidate digest is independent of file enumeration order", () => {
  expect(repairDigest("base-sha", files)).toBe(
    repairDigest("base-sha", files.toReversed()),
  );
});

test("candidate digest includes the verified Git file mode", () => {
  expect(repairDigest("base-sha", files)).not.toBe(
    repairDigest("base-sha", [{ ...files[0], mode: "100755" }, files[1]]),
  );
});

test("rejects a candidate changed by its verification command", () => {
  const before = repairDigest("base-sha", files);
  const after = repairDigest("base-sha", [
    files[0],
    { ...files[1], content: "export const b = 3;\n" },
  ]);

  expect(() => assertCandidateUnchanged(before, after)).toThrow(
    "Verification commands modified the repair candidate",
  );
});

test("records a check before stopping when that check mutates the workspace", () => {
  const checks: Array<{
    command: string[];
    exitCode: number;
    output: string;
  }> = [];
  const result = {
    command: ["bun", "test"],
    exitCode: 0,
    output: "passed but rewrote a snapshot",
  };

  expect(() =>
    recordCheckBeforeMutationStop(checks, result, "before", "after"),
  ).toThrow("modified the repair candidate");
  expect(checks).toEqual([result]);
});
