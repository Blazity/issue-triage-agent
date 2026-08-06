import { HttpError, errorResponse, readBoundedBody } from "@/http";
import { receiveIssueSignal } from "@/receive";
import { normalizeGenericWebhook, verifyHmacSignature } from "@/sources";

export async function POST(request: Request) {
  const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
    return Response.json(
      { error: "Generic webhook is not configured" },
      { status: 503 },
    );
  }

  try {
    const rawBody = await readBoundedBody(request);
    const signature = request.headers.get("x-triage-signature") ?? "";
    const timestamp = request.headers.get("x-triage-timestamp") ?? "";

    if (
      !verifyHmacSignature({
        rawBody,
        signature,
        timestamp,
        secret,
        now: new Date(),
        format: "generic",
      })
    ) {
      throw new HttpError(401, "Invalid or stale webhook signature");
    }

    const result = await receiveIssueSignal(
      normalizeGenericWebhook(JSON.parse(rawBody)),
    );
    return Response.json(result, {
      status: result.status === "accepted" ? 202 : 200,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
