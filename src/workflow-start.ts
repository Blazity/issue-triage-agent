import { randomUUID } from "node:crypto";

import type { IssueSignalStore } from "./admission";

export async function startWorkflowOnce(
  signalId: string,
  store: IssueSignalStore,
  startWorkflow: () => Promise<{ runId: string }>,
) {
  const claimId = randomUUID();
  const claim = await store.claimWorkflowStart(signalId, claimId);

  if (!claim.claimed) {
    if (!claim.runId) {
      throw new Error("Workflow start is reserved and requires reconciliation");
    }

    return { runId: claim.runId, started: false };
  }

  let run: { runId: string };

  try {
    run = await startWorkflow();
  } catch (error) {
    await store.releaseWorkflowStartClaim(signalId, claimId);
    throw error;
  }

  await store.markWorkflowStarted(signalId, claimId, run.runId);

  return { runId: run.runId, started: true };
}
