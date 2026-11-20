export const createRemoteJWKSet = () => ({});

export const jwtVerify = async () => ({
  payload: {
    sub: "oidc-e2e-sub",
    email: "e2e-oidc-admin@example.org",
    name: "E2E OIDC Admin",
    preferred_username: "e2e_oidc_admin",
    iss: process.env.OIDC_PUBLIC_ISSUER_URL || process.env.OIDC_ISSUER_URL,
    aud: process.env.OIDC_CLIENT_ID || "contenthub",
    azp: process.env.OIDC_CLIENT_ID || "contenthub",
    realm_access: { roles: ["admin"] },
    resource_access: {
      [process.env.OIDC_CLIENT_ID || "contenthub"]: { roles: ["admin"] },
    },
  },
});
