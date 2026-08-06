import { timingSafeEqual } from "node:crypto";

import { createNeonIssueSignalStore } from "@/neon-store";

function validBearerToken(request: Request, secret: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");

  if (!token) return false;

  const received = Buffer.from(token);
  const expected = Buffer.from(secret);

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json({ status: "not_configured" }, { status: 503 });
  }

  if (!validBearerToken(request, secret)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

  const deleted = await createNeonIssueSignalStore().cleanupExpiredRecords();
  return Response.json({ status: "ok", deleted });
}
