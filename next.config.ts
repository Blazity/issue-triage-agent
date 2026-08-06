import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@octokit/auth-app"],
};

export default withWorkflow(nextConfig);
