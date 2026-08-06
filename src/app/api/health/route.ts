import { config, configurationReadiness } from "@/runtime";
import { checkNeonReadiness } from "@/neon-store";

export async function GET() {
  const readiness = configurationReadiness(config, process.env);

  if (!readiness.ready) {
    return Response.json(
      { status: "not_ready", errors: readiness.errors },
      { status: 503 },
    );
  }

  try {
    if (!(await checkNeonReadiness())) {
      throw new Error("Database migrations are incomplete");
    }
  } catch {
    return Response.json(
      {
        status: "not_ready",
        errors: ["Database is unavailable or migrations are incomplete"],
      },
      { status: 503 },
    );
  }

  return Response.json({ status: "ready", service: "issue-triage-agent" });
}
