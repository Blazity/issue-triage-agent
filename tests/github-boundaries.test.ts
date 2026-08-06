import { expect, test } from "bun:test";

import { gitTreeEntry, readBoundedResponseBody } from "../src/github";

test("publishes the file mode verified in the Sandbox", () => {
  expect(
    gitTreeEntry(
      {
        path: "scripts/check.sh",
        content: "#!/bin/sh\nexit 0\n",
        mode: "100755",
      },
      "blob-sha",
    ),
  ).toEqual({
    path: "scripts/check.sh",
    mode: "100755",
    type: "blob",
    sha: "blob-sha",
  });
});

test("assembles every chunk of a bounded archive exactly once", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }),
  );

  expect(await readBoundedResponseBody(response, 4)).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
});

test("stops reading an archive when a streaming body exceeds its limit", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }),
  );

  await expect(readBoundedResponseBody(response, 5)).rejects.toThrow(
    "Repository archive exceeds 5 bytes",
  );
});
