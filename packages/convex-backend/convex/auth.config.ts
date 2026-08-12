import type { AuthConfig } from "convex/server";

const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;
const pipelineAudience = process.env.CLERK_M2M_AUDIENCE;

if (!issuerDomain) {
  throw new Error("CLERK_JWT_ISSUER_DOMAIN is required");
}
if (!pipelineAudience) {
  throw new Error("CLERK_M2M_AUDIENCE is required");
}

export default {
  providers: [
    {
      domain: issuerDomain,
      applicationID: "convex",
    },
    {
      domain: issuerDomain,
      applicationID: pipelineAudience,
    },
  ],
} satisfies AuthConfig;
