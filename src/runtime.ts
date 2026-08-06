import config from "../triage.config";
import type { TriageConfig } from "./config";

type RuntimeEnvironment = Record<string, string | undefined>;

export function configurationReadiness(
  triageConfig: TriageConfig,
  environment: RuntimeEnvironment,
) {
  const errors: string[] = [];

  if (environment.TRIAGE_ENABLED !== "true") {
    errors.push("TRIAGE_ENABLED must equal true");
  }

  if (!triageConfig.configured) {
    errors.push("Triage configuration is not configured");
  }

  for (const variable of [
    "DATABASE_URL",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "AI_GATEWAY_API_KEY",
    "TRIAGE_MODEL",
    "CRON_SECRET",
  ]) {
    if (!environment[variable]) {
      errors.push(`${variable} is required`);
    }
  }

  if (!environment.WEBHOOK_SECRET && !environment.ZENDESK_WEBHOOK_SECRET) {
    errors.push("At least one webhook secret is required");
  }

  if (environment.AI_DATA_POLICY_ACKNOWLEDGED !== "true") {
    errors.push("AI_DATA_POLICY_ACKNOWLEDGED must equal true");
  }

  if (
    Boolean(environment.SLACK_BOT_TOKEN) !==
    Boolean(environment.SLACK_CHANNEL_ID)
  ) {
    errors.push(
      "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be configured together",
    );
  }

  if (environment.WORKFLOW_RUN_URL_TEMPLATE) {
    try {
      renderWorkflowRunUrl(environment.WORKFLOW_RUN_URL_TEMPLATE, "readiness");
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Workflow URL is invalid",
      );
    }
  }

  return { ready: errors.length === 0, errors };
}

export function requireEnabled() {
  const readiness = configurationReadiness(config, process.env);

  if (!readiness.ready) {
    throw new Error(
      `Issue triage is not ready: ${readiness.errors.join("; ")}`,
    );
  }
}

export function workflowRunUrl(runId: string | null) {
  const template = process.env.WORKFLOW_RUN_URL_TEMPLATE;

  return template && runId ? renderWorkflowRunUrl(template, runId) : undefined;
}

export function renderWorkflowRunUrl(template: string, runId: string) {
  if (
    template.includes("your-team") ||
    template.includes("your-project") ||
    !template.includes("{runId}")
  ) {
    throw new Error("WORKFLOW_RUN_URL_TEMPLATE contains placeholders");
  }

  const rendered = template.replace("{runId}", encodeURIComponent(runId));
  const url = new URL(rendered);

  if (url.protocol !== "https:") {
    throw new Error("WORKFLOW_RUN_URL_TEMPLATE must use HTTPS");
  }

  return url.toString();
}

export { config };
