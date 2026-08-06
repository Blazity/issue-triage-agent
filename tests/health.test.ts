import { expect, test } from "bun:test";

import { GET as readiness } from "../src/app/api/health/route";
import { GET as liveness } from "../src/app/api/health/live/route";

test("readiness fails closed for an unconfigured deployment", async () => {
  const response = await readiness();

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "not_ready" });
});

test("liveness only reports that the process can answer", async () => {
  const response = liveness();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    service: "issue-triage-agent",
  });
});
