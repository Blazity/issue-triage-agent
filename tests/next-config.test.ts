import { expect, test } from "bun:test";

import nextConfig from "../next.config";

test("enables the Vercel Workflow Next.js integration", () => {
  expect(typeof nextConfig).toBe("function");
});
