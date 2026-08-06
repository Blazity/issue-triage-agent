import type { RepositoryConfig } from "./config";
import type { RepositoryResult, WorkflowAction } from "./domain";

export type ActionDecision = {
  action: WorkflowAction;
  reason:
    | "verified_repair"
    | "not_reproduced"
    | "insufficient_confidence"
    | "no_repair"
    | "checks_failed"
    | "blocked_path"
    | "path_not_allowed";
};

function globMatches(path: string, pattern: string): boolean {
  if (pattern.startsWith("**/") && globMatches(path, pattern.slice(3))) {
    return true;
  }

  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }

  return new RegExp(`${expression}$`).test(path);
}

export function isPathEligibleForAutomatedRepair(
  repository: RepositoryConfig,
  path: string,
) {
  return (
    !repository.policy.blockedPaths.some((pattern) =>
      globMatches(path, pattern),
    ) &&
    repository.policy.allowedPaths.some((pattern) => globMatches(path, pattern))
  );
}

export function isPathEligibleForModelAccess(
  repository: RepositoryConfig,
  path: string,
) {
  return isPathEligibleForAutomatedRepair(repository, path);
}

export function filterModelReadablePaths(
  repository: RepositoryConfig,
  paths: string[],
) {
  return paths.filter((path) => isPathEligibleForModelAccess(repository, path));
}

export function evaluateRepositoryAction(
  repository: RepositoryConfig,
  result: RepositoryResult,
): ActionDecision {
  if (!result.investigation.reproduced) {
    return { action: "notify", reason: "not_reproduced" };
  }

  if (result.investigation.confidence !== "high") {
    return { action: "notify", reason: "insufficient_confidence" };
  }

  if (!result.repair || result.repair.files.length === 0) {
    return { action: "notify", reason: "no_repair" };
  }

  if (result.repair.checks.some(({ exitCode }) => exitCode !== 0)) {
    return { action: "notify", reason: "checks_failed" };
  }

  if (
    result.repair.files.some(({ path }) =>
      repository.policy.blockedPaths.some((pattern) =>
        globMatches(path, pattern),
      ),
    )
  ) {
    return { action: "notify", reason: "blocked_path" };
  }

  if (
    result.repair.files.some(
      ({ path }) =>
        !repository.policy.allowedPaths.some((pattern) =>
          globMatches(path, pattern),
        ),
    )
  ) {
    return { action: "notify", reason: "path_not_allowed" };
  }

  return {
    action:
      repository.policy.pullRequestMode === "ready"
        ? "open_pr"
        : "open_draft_pr",
    reason: "verified_repair",
  };
}
