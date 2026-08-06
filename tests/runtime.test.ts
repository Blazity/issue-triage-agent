import { expect, test } from "bun:test";

import activeConfig from "../triage.config";
import { configurationReadiness, renderWorkflowRunUrl } from "../src/runtime";

test("a fresh checkout is disabled until real configuration is provided", () => {
  expect(activeConfig.repositories).toEqual([]);
  expect(activeConfig.routes).toEqual([]);

  expect(
    configurationReadiness(activeConfig, {
      TRIAGE_ENABLED: "true",
      DATABASE_URL: "postgres://example",
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      AI_GATEWAY_API_KEY: "gateway-key",
      TRIAGE_MODEL: "openai/gpt-5.4",
      CRON_SECRET: "cron-secret",
      AI_DATA_POLICY_ACKNOWLEDGED: "true",
      WEBHOOK_SECRET: "webhook-secret",
    }),
  ).toEqual({
    ready: false,
    errors: ["Triage configuration is not configured"],
  });
});

test("enablement is fail-closed", () => {
  expect(configurationReadiness(activeConfig, {}).errors).toContain(
    "TRIAGE_ENABLED must equal true",
  );
});

test("workflow links reject copied deployment placeholders", () => {
  expect(() =>
    renderWorkflowRunUrl(
      "https://vercel.com/your-team/your-project/observability/workflows/{runId}",
      "run-1",
    ),
  ).toThrow("WORKFLOW_RUN_URL_TEMPLATE contains placeholders");

  expect(
    renderWorkflowRunUrl(
      "https://vercel.com/acme/triage/observability/workflows/{runId}",
      "run/1",
    ),
  ).toBe("https://vercel.com/acme/triage/observability/workflows/run%2F1");
});
