import type { GatewayProviderOptions } from "@ai-sdk/gateway";

import type { CheckResult, IssueSignal } from "./domain";

const secretPatterns: RegExp[] = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s,;]+/gi,
  /\b(?:github_pat_[A-Za-z0-9_]+|gh[oprsu]_[A-Za-z0-9]{20,})\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:api[_-]?key|access[_-]?token|authorization[_-]?token|client[_-]?secret|database[_-]?url|password|private[_-]?key|secret)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
];
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const gatewayOptions = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  tags: ["feature:issue-triage"],
} satisfies GatewayProviderOptions;

Object.freeze(gatewayOptions.tags);
Object.freeze(gatewayOptions);

export const gatewayDataPolicy = Object.freeze({ gateway: gatewayOptions });

export function redactForModel(value: string, maximumLength = 20_000) {
  let redacted = value;

  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }

  redacted = redacted.replace(emailPattern, "[REDACTED_EMAIL]");

  if (redacted.length <= maximumLength) {
    return redacted;
  }

  return `${redacted.slice(0, maximumLength)}\n[TRUNCATED]`;
}

export function modelIssueContext(
  signal: IssueSignal,
  allowedMetadataKeys: string[],
) {
  const metadata: Record<string, string | number | boolean | null> = {};

  for (const key of allowedMetadataKeys) {
    if (!Object.hasOwn(signal.metadata ?? {}, key)) {
      continue;
    }

    const value = signal.metadata?.[key];
    metadata[key] =
      typeof value === "string"
        ? redactForModel(value, 1_000)
        : (value ?? null);
  }

  return {
    title: redactForModel(signal.title, 500),
    description: redactForModel(signal.description, 8_000),
    metadata,
  };
}

export function sanitizeCheckForModel(check: CheckResult): CheckResult {
  return {
    command: check.command.map((part) => redactForModel(part, 500)),
    exitCode: check.exitCode,
    output: redactForModel(check.output, 4_000),
  };
}
