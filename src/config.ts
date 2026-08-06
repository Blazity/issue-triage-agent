import { z } from "zod";

import type { IssueSignal } from "./domain";

const commandSchema = z.array(z.string().min(1)).min(1);

function isPlaceholder(value: string) {
  return value.startsWith("your-") || value === "replace-me";
}

const repositorySchema = z.object({
  key: z.string().min(1),
  owner: z.string().min(1).max(200),
  github: z.object({
    owner: z.string().min(1),
    repository: z.string().min(1),
    repositoryId: z.number().int().positive(),
    installationId: z.number().int().positive(),
    baseBranch: z.string().min(1).default("main"),
  }),
  sandbox: z.object({
    runtime: z.enum(["node24"]).default("node24"),
    bootstrap: z.array(commandSchema).max(3).default([]),
    checks: z.array(commandSchema).min(1).max(6),
    allowedEgress: z.array(z.string().min(1)).max(10).default([]),
  }),
  policy: z
    .object({
      maximumPatchAttempts: z.number().int().positive().max(3).default(2),
      pullRequestMode: z.enum(["draft", "ready"]).default("draft"),
      allowPublicPullRequests: z.boolean().default(false),
      includeIssueContextInPullRequest: z.boolean().default(false),
      modelMetadataKeys: z
        .array(z.string().min(1).max(100))
        .max(50)
        .default([]),
      allowedPaths: z.array(z.string().min(1)).default(["**"]),
      blockedPaths: z
        .array(z.string().min(1))
        .default([
          ".github/**",
          "**/.env*",
          "**/*lock*",
          "**/package.json",
          "**/auth/**",
          "**/migrations/**",
          "**/terraform/**",
        ]),
    })
    .prefault({}),
});

const triageConfigSchema = z
  .object({
    configured: z.boolean().default(false),
    version: z.string().min(1).max(100).default("1"),
    repositories: z.array(repositorySchema).default([]),
    routes: z
      .array(
        z.object({
          source: z.string().min(1),
          routingKey: z.string().min(1),
          repositories: z.array(z.string().min(1)).min(1),
        }),
      )
      .default([]),
    limits: z
      .object({
        maximumRepositoriesPerIncident: z
          .number()
          .int()
          .positive()
          .max(10)
          .default(3),
        maximumActiveRuns: z.number().int().positive().max(20).default(3),
        maximumActiveRunsPerRepository: z.literal(1).default(1),
        maximumModelStepsPerRepository: z
          .number()
          .int()
          .positive()
          .max(10)
          .default(4),
        maximumModelStepsPerIncident: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20),
        maximumRunDurationSeconds: z
          .number()
          .int()
          .positive()
          .max(3_600)
          .default(600),
        maximumPullRequestsPerRepositoryPerDay: z
          .number()
          .int()
          .positive()
          .max(20)
          .default(3),
        sourceEventsPerMinute: z
          .number()
          .int()
          .positive()
          .max(1_000)
          .default(60),
      })
      .prefault({}),
  })
  .superRefine((config, context) => {
    const repositoryKeys = new Set(config.repositories.map(({ key }) => key));
    const repositoryIdentities = new Set(
      config.repositories.map(repositoryIdentity),
    );

    if (repositoryKeys.size !== config.repositories.length) {
      context.addIssue({
        code: "custom",
        message: "Repository keys must be unique",
      });
    }

    if (repositoryIdentities.size !== config.repositories.length) {
      context.addIssue({
        code: "custom",
        message: "GitHub repository identities must be unique",
      });
    }

    if (config.configured && config.repositories.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Configured triage requires at least one repository",
      });
    }

    if (config.configured && config.routes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Configured triage requires at least one route",
      });
    }

    if (
      config.configured &&
      config.repositories.some(
        ({ github }) =>
          isPlaceholder(github.owner) || isPlaceholder(github.repository),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "GitHub owner and repository placeholders must be replaced",
      });
    }

    if (
      !config.configured &&
      (config.repositories.length > 0 || config.routes.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Unconfigured triage cannot define active routes or repositories",
      });
    }

    for (const route of config.routes) {
      for (const repositoryKey of route.repositories) {
        if (!repositoryKeys.has(repositoryKey)) {
          context.addIssue({
            code: "custom",
            message: `Route references unknown repository: ${repositoryKey}`,
          });
        }
      }
    }
  });

export type TriageConfig = z.infer<typeof triageConfigSchema>;
export type RepositoryConfig = TriageConfig["repositories"][number];

export function repositoryIdentity(repository: RepositoryConfig) {
  return `${repository.github.installationId}:${repository.github.repositoryId}`;
}

export function defineTriageConfig(config: unknown): TriageConfig {
  return triageConfigSchema.parse(config);
}

export function resolveRepositories(signal: IssueSignal, config: TriageConfig) {
  const selectedKeys = new Set<string>();

  for (const route of config.routes) {
    if (
      route.source !== signal.source ||
      !signal.routingKeys.includes(route.routingKey)
    ) {
      continue;
    }

    for (const repositoryKey of route.repositories) {
      selectedKeys.add(repositoryKey);
    }
  }

  if (selectedKeys.size > config.limits.maximumRepositoriesPerIncident) {
    throw new Error(
      `Route selects ${selectedKeys.size} repositories and exceeds maximumRepositoriesPerIncident=${config.limits.maximumRepositoriesPerIncident}`,
    );
  }

  return config.repositories.filter(({ key }) => selectedKeys.has(key));
}
