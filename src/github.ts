import { createHash } from "node:crypto";

import { createAppAuth } from "@octokit/auth-app";
import { request as octokitRequest } from "@octokit/request";

import type { RepositoryConfig } from "./config";
import {
  assertExpectedBranchCommit,
  assertExpectedPullRequest,
  pullRequestDisclosure,
} from "./disclosure";
import type { IssueSignal, Repair, RepairFile } from "./domain";

const githubApiVersion = "2026-03-10";
const maximumArchiveBytes = 25 * 1024 * 1024;
const requestTimeoutMs = 30_000;

type GitHubPermission = "read" | "write";

function requestSignal(deadlineAt?: string) {
  const remaining = deadlineAt
    ? new Date(deadlineAt).getTime() - Date.now()
    : requestTimeoutMs;

  if (remaining <= 0) {
    throw new Error("Repository run deadline elapsed");
  }

  return AbortSignal.timeout(Math.min(requestTimeoutMs, remaining));
}

function createAuthentication(deadlineAt?: string) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  }

  return createAppAuth({
    appId,
    privateKey,
    request: octokitRequest.defaults({
      request: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, signal: requestSignal(deadlineAt) }),
      },
    }),
  });
}

async function installationToken(
  repository: RepositoryConfig,
  permissions: Record<string, GitHubPermission>,
  deadlineAt?: string,
) {
  const authentication = await createAuthentication(deadlineAt)({
    type: "installation",
    installationId: repository.github.installationId,
    repositoryIds: [repository.github.repositoryId],
    permissions,
  });

  return authentication.token;
}

async function githubRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  deadlineAt?: string,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    signal: init.signal ?? requestSignal(deadlineAt),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": githubApiVersion,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}): ${(await response.text()).slice(0, 1_000)}`,
    );
  }

  return (await response.json()) as T;
}

async function githubRequestOrNull<T>(
  token: string,
  path: string,
  deadlineAt?: string,
) {
  try {
    return await githubRequest<T>(token, path, {}, deadlineAt);
  } catch (error) {
    if (error instanceof Error && error.message.includes("failed (404)")) {
      return null;
    }

    throw error;
  }
}

export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
) {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);

  if (declaredSize > maximumBytes) {
    throw new Error(`Repository archive exceeds ${maximumBytes} bytes`);
  }

  if (!response.body) {
    throw new Error("Repository archive response has no body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`Repository archive exceeds ${maximumBytes} bytes`);
    }

    chunks.push(value);
  }

  const archive = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return archive;
}

function repositoryPath(repository: RepositoryConfig) {
  return `/repos/${encodeURIComponent(repository.github.owner)}/${encodeURIComponent(repository.github.repository)}`;
}

export async function downloadRepositoryArchive(
  repository: RepositoryConfig,
  deadlineAt?: string,
  baseSha?: string,
) {
  const token = await installationToken(
    repository,
    { contents: "read" },
    deadlineAt,
  );
  const base = repositoryPath(repository);
  const resolvedBaseSha =
    baseSha ?? (await resolveBaseSha(token, repository, deadlineAt));
  const archiveResponse = await fetch(
    `https://api.github.com${base}/tarball/${resolvedBaseSha}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": githubApiVersion,
      },
      redirect: "manual",
      signal: requestSignal(deadlineAt),
    },
  );
  const location = archiveResponse.headers.get("location");

  if (
    !location ||
    ![301, 302, 303, 307, 308].includes(archiveResponse.status)
  ) {
    throw new Error(
      `GitHub archive request failed (${archiveResponse.status})`,
    );
  }

  const download = await fetch(location, {
    redirect: "error",
    signal: requestSignal(deadlineAt),
  });

  if (!download.ok) {
    throw new Error(`GitHub archive download failed (${download.status})`);
  }

  const archive = await readBoundedResponseBody(download, maximumArchiveBytes);

  return { archive, baseSha: resolvedBaseSha };
}

export async function resolveRepositorySnapshot(
  repository: RepositoryConfig,
  deadlineAt?: string,
) {
  const token = await installationToken(
    repository,
    { contents: "read" },
    deadlineAt,
  );

  return {
    baseSha: await resolveBaseSha(token, repository, deadlineAt),
  };
}

async function resolveBaseSha(
  token: string,
  repository: RepositoryConfig,
  deadlineAt?: string,
) {
  const reference = await githubRequest<{ object: { sha: string } }>(
    token,
    `${repositoryPath(repository)}/git/ref/heads/${encodeURIComponent(repository.github.baseBranch)}`,
    {},
    deadlineAt,
  );

  return reference.object.sha;
}

function deterministicBranch(
  signal: IssueSignal,
  repository: RepositoryConfig,
) {
  const suffix = createHash("sha256")
    .update(
      `${signal.source}\0${signal.sourceAccount}\0${signal.sourceEventId}\0${repository.key}`,
    )
    .digest("hex")
    .slice(0, 12);

  return `triage/${repository.key.replace(/[^a-zA-Z0-9-]/g, "-")}-${suffix}`;
}

export async function createOrFindPullRequest(
  signal: IssueSignal,
  repository: RepositoryConfig,
  repair: Repair,
  deadlineAt?: string,
) {
  const token = await installationToken(
    repository,
    {
      contents: "write",
      pull_requests: "write",
    },
    deadlineAt,
  );
  const base = repositoryPath(repository);
  const branch = deterministicBranch(signal, repository);
  const request = <T>(path: string, init: RequestInit = {}) =>
    githubRequest<T>(token, path, init, deadlineAt);
  const requestOrNull = <T>(path: string) =>
    githubRequestOrNull<T>(token, path, deadlineAt);
  const metadata = await request<{ private: boolean }>(base);

  if (!metadata.private && !repository.policy.allowPublicPullRequests) {
    throw new Error(
      "Automatic pull requests to public repositories are disabled; human review is required",
    );
  }

  const baseReference = await request<{ object: { sha: string } }>(
    `${base}/git/ref/heads/${encodeURIComponent(repository.github.baseBranch)}`,
  );

  if (baseReference.object.sha !== repair.baseSha) {
    throw new Error("Repository base changed after investigation");
  }

  const disclosure = pullRequestDisclosure(
    signal,
    repair,
    repository.policy.includeIssueContextInPullRequest,
  );
  const baseCommit = await request<{ tree: { sha: string } }>(
    `${base}/git/commits/${repair.baseSha}`,
  );
  const treeEntries = await Promise.all(
    repair.files.map(async (file) => {
      const blob = await request<{ sha: string }>(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      });

      return {
        ...gitTreeEntry(file, blob.sha),
      };
    }),
  );
  const tree = await request<{ sha: string }>(`${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: treeEntries,
    }),
  });
  const occurredAt = Date.parse(signal.occurredAt);
  const commitDate = Number.isFinite(occurredAt)
    ? new Date(occurredAt).toISOString()
    : "2000-01-01T00:00:00.000Z";
  const commit = await request<{ sha: string }>(`${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: disclosure.commitMessage,
      tree: tree.sha,
      parents: [repair.baseSha],
      author: {
        name: "Issue Triage Agent",
        email: "issue-triage-agent@users.noreply.github.com",
        date: commitDate,
      },
      committer: {
        name: "Issue Triage Agent",
        email: "issue-triage-agent@users.noreply.github.com",
        date: commitDate,
      },
    }),
  });
  const branchPath = `${base}/git/ref/heads/${encodeURIComponent(branch)}`;
  const branchReference = await requestOrNull<{
    object: { sha: string };
  }>(branchPath);

  if (branchReference) {
    assertExpectedBranchCommit(branchReference.object.sha, commit.sha);
  } else {
    try {
      await request(`${base}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: commit.sha,
        }),
      });
    } catch (error) {
      const concurrentReference = await requestOrNull<{
        object: { sha: string };
      }>(branchPath);

      if (!concurrentReference) throw error;
      assertExpectedBranchCommit(concurrentReference.object.sha, commit.sha);
    }
  }

  const openPullRequests = await request<
    Array<{
      html_url: string;
      number: number;
      draft: boolean;
      head: { sha: string };
      base: { ref: string };
    }>
  >(
    `${base}/pulls?state=open&head=${encodeURIComponent(`${repository.github.owner}:${branch}`)}`,
  );

  if (openPullRequests[0]) {
    assertExpectedPullRequest(
      {
        headSha: openPullRequests[0].head.sha,
        baseRef: openPullRequests[0].base.ref,
        draft: openPullRequests[0].draft,
      },
      {
        headSha: commit.sha,
        baseRef: repository.github.baseBranch,
        draft: repository.policy.pullRequestMode === "draft",
      },
    );

    return {
      url: openPullRequests[0].html_url,
      number: openPullRequests[0].number,
      branch,
    };
  }

  const previousPullRequests = await request<
    Array<{ html_url: string; number: number }>
  >(
    `${base}/pulls?state=closed&head=${encodeURIComponent(`${repository.github.owner}:${branch}`)}`,
  );

  if (previousPullRequests[0]) {
    throw new Error(
      "A previous pull request for this incident is closed; human review is required",
    );
  }

  const pullRequest = await request<{ html_url: string; number: number }>(
    `${base}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: disclosure.title,
        head: branch,
        base: repository.github.baseBranch,
        draft: repository.policy.pullRequestMode === "draft",
        body: disclosure.body,
      }),
    },
  );

  return { url: pullRequest.html_url, number: pullRequest.number, branch };
}

export function gitTreeEntry(file: RepairFile, blobSha: string) {
  return {
    path: file.path,
    mode: file.mode,
    type: "blob" as const,
    sha: blobSha,
  };
}
