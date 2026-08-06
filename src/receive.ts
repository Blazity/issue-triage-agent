import { start } from "workflow/api";

import { admitIssueSignal } from "./admission";
import { resolveRepositories } from "./config";
import type { IssueSignal } from "./domain";
import { createNeonIssueSignalStore } from "./neon-store";
import { config, requireEnabled, workflowRunUrl } from "./runtime";
import { postStartedSlackMessage, slackIsConfigured } from "./slack";
import { startWorkflowOnce } from "./workflow-start";
import { incidentWorkflow } from "./workflow";

export async function receiveIssueSignal(signal: IssueSignal) {
  requireEnabled();
  const repositoryKeys = resolveRepositories(signal, config).map(
    ({ key }) => key,
  );
  const store = createNeonIssueSignalStore();
  const admission = await admitIssueSignal(signal, repositoryKeys, store, {
    now: new Date(),
    sourceEventsPerMinute: config.limits.sourceEventsPerMinute,
    policyVersion: config.version,
  });

  if (admission.status === "ignored" || admission.status === "suppressed") {
    return admission;
  }

  const workflow = await startWorkflowOnce(
    admission.signalId,
    store,
    async () => {
      const run = await start(incidentWorkflow, [admission.signalId]);
      return { runId: run.runId };
    },
  );

  if (
    slackIsConfigured() &&
    (await store.claimInitialNotification(admission.signalId))
  ) {
    try {
      const message = await postStartedSlackMessage(
        signal,
        workflowRunUrl(workflow.runId),
      );
      await store.saveSlackMessageTimestamp(admission.signalId, message.id);
    } catch (error) {
      await store.releaseInitialNotificationClaim(admission.signalId);
      throw error;
    }
  }

  return { ...admission, ...workflow };
}
