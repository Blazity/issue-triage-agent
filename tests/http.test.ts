import { expect, test } from "bun:test";

import { readBoundedBody } from "../src/http";

test("stops reading a streaming webhook as soon as it exceeds the body limit", async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;

      if (pulls <= 3) {
        controller.enqueue(new Uint8Array(128 * 1024));
        return;
      }

      controller.error(new Error("reader consumed past the configured bound"));
    },
  });
  const request = new Request("https://example.com/webhook", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await expect(readBoundedBody(request)).rejects.toThrow(
    "Webhook body exceeds 256 KiB",
  );
  expect(pulls).toBe(3);
});
