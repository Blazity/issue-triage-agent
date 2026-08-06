import { HttpError, errorResponse, readBoundedBody } from "@/http";
import { receiveIssueSignal } from "@/receive";
import { normalizeZendeskWebhook, verifyHmacSignature } from "@/sources";

export async function POST(request: Request) {
  const secret = process.env.ZENDESK_WEBHOOK_SECRET;

  if (!secret) {
    return Response.json(
      { error: "Zendesk webhook is not configured" },
      { status: 503 },
    );
  }

  try {
    const rawBody = await readBoundedBody(request);
    const signature = request.headers.get("x-zendesk-webhook-signature") ?? "";
    const timestamp =
      request.headers.get("x-zendesk-webhook-signature-timestamp") ?? "";

    if (
      !verifyHmacSignature({
        rawBody,
        signature,
        timestamp,
        secret,
        now: new Date(),
        format: "zendesk",
      })
    ) {
      throw new HttpError(401, "Invalid or stale Zendesk signature");
    }

    const result = await receiveIssueSignal(
      normalizeZendeskWebhook(JSON.parse(rawBody)),
    );
    return Response.json(result, {
      status: result.status === "accepted" ? 202 : 200,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
