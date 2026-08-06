import { postSlackMessage, updateSlackMessage } from "@chat-adapter/slack/api";

import type { IssueSignal } from "./domain";
import type { RepositoryOutcome } from "./incident";

type SlackMessage = {
  text: string;
  blocks: Array<Record<string, unknown>>;
};

const maximumSectionText = 3_000;
const slackTimeoutMs = 30_000;

const boundedSlackFetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(slackTimeoutMs)])
      : AbortSignal.timeout(slackTimeoutMs),
  })) as typeof fetch;

function truncate(value: string, maximum = maximumSectionText) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function escapeSlack(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function links(signal: IssueSignal, workflowUrl?: string) {
  return [
    signal.url ? `<${signal.url}|Open source issue>` : null,
    workflowUrl ? `<${workflowUrl}|Open Workflow run>` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

export function createStartedSlackMessage(
  signal: IssueSignal,
  workflowUrl?: string,
): SlackMessage {
  return {
    text: `Investigating: ${signal.title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🔎 Issue investigation started" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncate(
            `*${escapeSlack(signal.title)}*\n${links(signal, workflowUrl)}`,
          ),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Repositories are being inspected in isolated sandboxes. This message will update automatically.",
          },
        ],
      },
    ],
  };
}

export function createFinalSlackMessage(
  signal: IssueSignal,
  outcomes: RepositoryOutcome[],
  workflowUrl?: string,
): SlackMessage {
  const pullRequests = outcomes.filter(
    ({ status }) => status === "pull_request_opened",
  );
  const headline =
    pullRequests.length > 0
      ? "✅ Fixes ready for human review"
      : "⚠️ Human review needed";
  const summaries = outcomes.map((outcome) => {
    const pullRequest = outcome.pullRequestUrl
      ? `\n<${outcome.pullRequestUrl}|Review pull request>`
      : "";
    const assessment = outcome.assessment;
    const checks = outcome.checks?.length
      ? `*Checks:* ${outcome.checks
          .map(
            (check) =>
              `${escapeSlack(check.command.join(" "))}: ${
                check.exitCode === 0 ? "passed" : "failed"
              }`,
          )
          .join("; ")}`
      : null;
    const details = assessment
      ? [
          `*Verdict:* ${escapeSlack(assessment.verdict.replaceAll("_", " "))} · *Severity:* ${escapeSlack(assessment.severity)} · *Owner:* ${escapeSlack(assessment.owner)}`,
          `*What happened:* ${escapeSlack(outcome.summary)}`,
          assessment.reproductionSteps.length
            ? `*Reproduction:* ${assessment.reproductionSteps.map(escapeSlack).join("; ")}`
            : null,
          assessment.supportingEvidence.length
            ? `*Proof:* ${assessment.supportingEvidence.map(escapeSlack).join("; ")}`
            : null,
          assessment.contradictingEvidence.length
            ? `*Contradicting evidence:* ${assessment.contradictingEvidence.map(escapeSlack).join("; ")}`
            : null,
          checks,
          `*Next action:* ${escapeSlack(assessment.recommendedNextAction)}`,
        ]
          .filter(Boolean)
          .join("\n")
      : [escapeSlack(outcome.summary), checks].filter(Boolean).join("\n");
    return truncate(
      `*${escapeSlack(outcome.repositoryKey)}*\n${details}${pullRequest}`,
    );
  });

  return {
    text: `${headline}: ${signal.title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: headline },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncate(
            `*${escapeSlack(signal.title)}*\n${links(signal, workflowUrl)}`,
          ),
        },
      },
      { type: "divider" },
      ...summaries.map((summary) => ({
        type: "section",
        text: { type: "mrkdwn", text: summary },
      })),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Issue Triage Agent never merges, releases, or deploys. A human owns every final action.",
          },
        ],
      },
    ],
  };
}

export function slackIsConfigured() {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

export async function postStartedSlackMessage(
  signal: IssueSignal,
  workflowUrl?: string,
) {
  const channel = process.env.SLACK_CHANNEL_ID;

  if (!channel) {
    throw new Error("SLACK_CHANNEL_ID is required");
  }

  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }

  return postSlackMessage({
    token,
    fetch: boundedSlackFetch,
    channel,
    ...createStartedSlackMessage(signal, workflowUrl),
  });
}

export async function publishFinalSlackMessage(
  signal: IssueSignal,
  outcomes: RepositoryOutcome[],
  messageTimestamp: string | null,
  workflowUrl?: string,
) {
  const channel = process.env.SLACK_CHANNEL_ID;

  if (!channel) {
    throw new Error("SLACK_CHANNEL_ID is required");
  }

  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }

  const message = createFinalSlackMessage(signal, outcomes, workflowUrl);

  return messageTimestamp
    ? updateSlackMessage({
        token,
        fetch: boundedSlackFetch,
        channel,
        ts: messageTimestamp,
        ...message,
      })
    : postSlackMessage({
        token,
        fetch: boundedSlackFetch,
        channel,
        ...message,
      });
}
