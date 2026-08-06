import { expect, test } from "bun:test";

import { GET } from "../src/app/api/maintenance/retention/route";

test("retention maintenance fails closed without a configured secret", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  try {
    const response = await GET(
      new Request("https://example.com/api/maintenance/retention"),
    );

    expect(response.status).toBe(503);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("retention maintenance rejects an invalid bearer token", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "retention-secret";

  try {
    const response = await GET(
      new Request("https://example.com/api/maintenance/retention", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
