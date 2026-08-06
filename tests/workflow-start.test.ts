import { expect, test } from "bun:test";

import {
  admitIssueSignal,
  createInMemoryAdmissionStore,
  type IssueSignalStore,
} from "../src/admission";
import type { IssueSignal } from "../src/domain";
import { startWorkflowOnce } from "../src/workflow-start";

test("starts one workflow for repeated delivery handling", async () => {
  const store = createInMemoryAdmissionStore() as IssueSignalStore;
  const signal: IssueSignal = {
    source: "webhook",
    sourceAccount: "acme",
    sourceEventId: "delivery-1",
    routingKeys: ["checkout"],
    title: "Checkout is failing",
    description: "Customers cannot pay.",
    occurredAt: "2026-08-06T10:00:00.000Z",
  };
  const admission = await admitIssueSignal(signal, ["storefront"], store, {
    now: new Date("2026-08-06T10:00:00.000Z"),
    sourceEventsPerMinute: 60,
  });

  if (admission.status !== "accepted") {
    throw new Error("Expected accepted admission");
  }

  let starts = 0;
  const start = async () => ({ runId: `run-${++starts}` });
  const first = await startWorkflowOnce(admission.signalId, store, start);
  const repeated = await startWorkflowOnce(admission.signalId, store, start);

  expect(first).toEqual({ runId: "run-1", started: true });
  expect(repeated).toEqual({ runId: "run-1", started: false });
  expect(starts).toBe(1);
});

test("releases a start claim when no workflow was created", async () => {
  const store = createInMemoryAdmissionStore();
  const admission = await admitIssueSignal(
    {
      source: "webhook",
      sourceAccount: "acme",
      sourceEventId: "delivery-retry",
      routingKeys: ["checkout"],
      title: "Checkout is failing",
      description: "Customers cannot pay.",
      occurredAt: "2026-08-06T10:00:00.000Z",
    },
    ["storefront"],
    store,
    {
      now: new Date("2026-08-06T10:00:00.000Z"),
      sourceEventsPerMinute: 60,
    },
  );

  if (admission.status !== "accepted") {
    throw new Error("Expected accepted admission");
  }

  await expect(
    startWorkflowOnce(admission.signalId, store, async () => {
      throw new Error("Workflow service unavailable");
    }),
  ).rejects.toThrow("Workflow service unavailable");

  expect(
    await startWorkflowOnce(admission.signalId, store, async () => ({
      runId: "run-recovered",
    })),
  ).toEqual({ runId: "run-recovered", started: true });
});
