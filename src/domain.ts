export type IssueSignal = {
  source: string;
  sourceAccount: string;
  sourceEventId: string;
  routingKeys: string[];
  title: string;
  description: string;
  occurredAt: string;
  url?: string;
  origin?: {
    actor?: string;
    generatedBy?: string;
    runDepth?: number;
  };
  metadata?: Record<string, string | number | boolean | null>;
};

export type WorkflowAction = "notify" | "open_draft_pr" | "open_pr";

export type HumanAssessment = {
  verdict: "confirmed" | "likely_false_positive" | "inconclusive";
  severity: "unknown" | "low" | "medium" | "high" | "critical";
  owner: string;
  reproductionSteps: string[];
  supportingEvidence: string[];
  contradictingEvidence: string[];
  recommendedNextAction: string;
};

export type Investigation = {
  reproduced: boolean;
  confidence: "low" | "high";
  summary: string;
} & HumanAssessment;

export type RepairFile = {
  path: string;
  content: string;
  mode: "100644" | "100755";
};

export type CheckResult = {
  command: string[];
  exitCode: number;
  output: string;
};

export type Repair = {
  summary: string;
  baseSha: string;
  digest: string;
  files: RepairFile[];
  checks: CheckResult[];
};

export type RepositoryResult = {
  investigation: Investigation;
  repair: Repair | null;
  checks: CheckResult[];
};
