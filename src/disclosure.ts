import type { IssueSignal, Repair } from "./domain";

function oneLine(value: string, maximumLength: number) {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

export function pullRequestDisclosure(
  signal: IssueSignal,
  repair: Repair,
  includeIssueContext: boolean,
) {
  const verification = repair.checks.map(
    (check) =>
      `- ${check.command.map((part) => oneLine(part, 100)).join(" ")}: ${
        check.exitCode === 0 ? "passed" : "failed"
      }`,
  );
  const issueContext = includeIssueContext
    ? [
        "## Source issue",
        oneLine(signal.title, 500),
        signal.url?.startsWith("https://") ? signal.url : null,
        "",
      ].filter((value): value is string => Boolean(value))
    : [];

  return {
    title: includeIssueContext
      ? `Fix: ${oneLine(signal.title, 170)}`
      : "Automated issue triage repair",
    commitMessage: includeIssueContext
      ? `fix: ${oneLine(signal.title, 110)}`
      : "fix: apply verified issue triage repair",
    body: [
      ...issueContext,
      "## Summary",
      includeIssueContext
        ? oneLine(repair.summary, 1_000)
        : "A verified repair candidate passed the configured repository checks.",
      "",
      "## Verification",
      ...verification,
      "",
      `Candidate: \`${repair.digest}\``,
      "",
      "> Created by Issue Triage Agent. Human review and merge are required.",
    ].join("\n"),
  };
}

export function assertExpectedBranchCommit(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(
      "The deterministic triage branch does not match the verified candidate; human review is required",
    );
  }
}

export function assertExpectedPullRequest(
  actual: { headSha: string; baseRef: string; draft: boolean },
  expected: { headSha: string; baseRef: string; draft: boolean },
) {
  if (
    actual.headSha !== expected.headSha ||
    actual.baseRef !== expected.baseRef ||
    actual.draft !== expected.draft
  ) {
    throw new Error(
      "The existing pull request does not match the verified candidate and repository policy; human review is required",
    );
  }
}
