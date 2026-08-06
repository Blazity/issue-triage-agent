import { ZodError } from "zod";

const maximumBodyBytes = 256 * 1024;

export async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > maximumBodyBytes) {
    throw new HttpError(413, "Webhook body exceeds 256 KiB");
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;

    if (bytesRead > maximumBodyBytes) {
      await reader.cancel();
      throw new HttpError(413, "Webhook body exceeds 256 KiB");
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  throw error;
}
