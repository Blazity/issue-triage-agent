import { expect, test } from "bun:test";

import {
  createPatchAttemptGuard,
  isVerifiedReproduction,
  resolveAgentStepLimit,
} from "../src/repository-agent";
import { allocateIncidentModelSteps } from "../src/workflow";

test("uses the strictest configured bound for an agent loop", () => {
  expect(
    resolveAgentStepLimit({
      maximumPatchAttempts: 3,
      maximumModelStepsPerRepository: 4,
      allocatedIncidentSteps: 20,
    }),
  ).toBe(4);

  expect(
    resolveAgentStepLimit({
      maximumPatchAttempts: 3,
      maximumModelStepsPerRepository: 10,
      allocatedIncidentSteps: 3,
    }),
  ).toBe(3);
});

test("enforces patch attempts independently from the agent step ceiling", () => {
  const guard = createPatchAttemptGuard(2);

  guard.record();
  guard.record();
  expect(() => guard.record()).toThrow("Maximum patch attempts exceeded");
});

test("requires one named failing check to pass after the repair", () => {
  const baseline = [
    { command: ["bun", "test"], exitCode: 1, output: "failure" },
    { command: ["bun", "lint"], exitCode: 0, output: "ok" },
  ];
  const final = [
    { command: ["bun", "test"], exitCode: 0, output: "ok" },
    { command: ["bun", "lint"], exitCode: 0, output: "ok" },
  ];

  expect(isVerifiedReproduction(0, baseline, final)).toBe(true);
  expect(isVerifiedReproduction(1, baseline, final)).toBe(false);
  expect(isVerifiedReproduction(null, baseline, final)).toBe(false);
});

test("incident model-step allocation never exceeds the incident ceiling", () => {
  expect(allocateIncidentModelSteps(6, 3)).toEqual([1, 1, 1, 0, 0, 0]);
  expect(allocateIncidentModelSteps(3, 8)).toEqual([3, 3, 2]);
});
