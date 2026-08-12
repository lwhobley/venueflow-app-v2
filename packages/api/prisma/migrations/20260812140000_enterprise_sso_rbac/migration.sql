-- Enterprise SSO: Passport SAML / OpenID Connect configuration, signed-claim
-- group mapping, and one-time login handoff. Client secrets are referenced by
-- Cloud Run environment variable name and never stored in this database.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'concourse_supervisor';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'suite_manager';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'auditor';

CREATE TYPE "EnterpriseSsoProtocol" AS ENUM ('saml', 'oidc');
CREATE TYPE "EnterpriseSsoProviderStatus" AS ENUM ('draft', 'active', 'disabled');

CREATE TABLE "EnterpriseSsoProvider" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "protocol" "EnterpriseSsoProtocol" NOT NULL,
  "status" "EnterpriseSsoProviderStatus" NOT NULL DEFAULT 'draft',
  "defaultFacilityId" TEXT,
  "jitProvisioningEnabled" BOOLEAN NOT NULL DEFAULT false,
  "allowedEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "groupClaim" TEXT NOT NULL DEFAULT 'groups',
  "postLoginRedirectUri" TEXT,
  "oidcIssuer" TEXT,
  "oidcClientId" TEXT,
  "clientSecretEnvKey" TEXT,
  "samlEntryPoint" TEXT,
  "samlIdpCertificate" TEXT,
  "samlServiceProviderIssuer" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseSsoProvider_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnterpriseSsoProvider_active_configuration_check" CHECK (
    "status" <> 'active' OR (
      ("protocol" = 'oidc' AND "oidcIssuer" IS NOT NULL AND "oidcClientId" IS NOT NULL AND "clientSecretEnvKey" IS NOT NULL)
      OR
      ("protocol" = 'saml' AND "samlEntryPoint" IS NOT NULL AND "samlIdpCertificate" IS NOT NULL AND "samlServiceProviderIssuer" IS NOT NULL)
    )
  ),
  CONSTRAINT "EnterpriseSsoProvider_secret_key_format_check" CHECK (
    "clientSecretEnvKey" IS NULL OR "clientSecretEnvKey" ~ '^SSO_[A-Z0-9_]+$'
  )
);

CREATE TABLE "EnterpriseSsoGroupRoleMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "externalGroup" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "facilityId" TEXT,
  "zoneId" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseSsoGroupRoleMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnterpriseSsoGroupRoleMapping_zone_requires_facility_check" CHECK ("zoneId" IS NULL OR "facilityId" IS NOT NULL)
);

CREATE TABLE "EnterpriseSsoIdentity" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "lastAuthenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EnterpriseSsoIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseSsoLoginRequest" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "stateHash" TEXT,
  "nonceHash" TEXT,
  "samlRequestId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnterpriseSsoLoginRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseSsoLoginTicket" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnterpriseSsoLoginTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnterpriseSsoProvider_organizationId_slug_key" ON "EnterpriseSsoProvider"("organizationId", "slug");
CREATE UNIQUE INDEX "EnterpriseSsoProvider_organizationId_id_key" ON "EnterpriseSsoProvider"("organizationId", "id");
CREATE INDEX "EnterpriseSsoProvider_organizationId_status_idx" ON "EnterpriseSsoProvider"("organizationId", "status");
CREATE UNIQUE INDEX "EnterpriseSsoGroupRoleMapping_providerId_externalGroup_key" ON "EnterpriseSsoGroupRoleMapping"("providerId", "externalGroup");
CREATE INDEX "EnterpriseSsoGroupRoleMapping_providerId_active_priority_idx" ON "EnterpriseSsoGroupRoleMapping"("providerId", "active", "priority");
CREATE INDEX "EnterpriseSsoGroupRoleMapping_organizationId_facilityId_zoneId_idx" ON "EnterpriseSsoGroupRoleMapping"("organizationId", "facilityId", "zoneId");
CREATE UNIQUE INDEX "EnterpriseSsoIdentity_providerId_subject_key" ON "EnterpriseSsoIdentity"("providerId", "subject");
CREATE UNIQUE INDEX "EnterpriseSsoIdentity_providerId_userId_key" ON "EnterpriseSsoIdentity"("providerId", "userId");
CREATE INDEX "EnterpriseSsoIdentity_userId_idx" ON "EnterpriseSsoIdentity"("userId");
CREATE UNIQUE INDEX "EnterpriseSsoLoginRequest_stateHash_key" ON "EnterpriseSsoLoginRequest"("stateHash");
CREATE UNIQUE INDEX "EnterpriseSsoLoginRequest_samlRequestId_key" ON "EnterpriseSsoLoginRequest"("samlRequestId");
CREATE INDEX "EnterpriseSsoLoginRequest_providerId_expiresAt_idx" ON "EnterpriseSsoLoginRequest"("providerId", "expiresAt");
CREATE UNIQUE INDEX "EnterpriseSsoLoginTicket_secretHash_key" ON "EnterpriseSsoLoginTicket"("secretHash");
CREATE INDEX "EnterpriseSsoLoginTicket_userId_expiresAt_idx" ON "EnterpriseSsoLoginTicket"("userId", "expiresAt");
CREATE INDEX "EnterpriseSsoLoginTicket_providerId_expiresAt_idx" ON "EnterpriseSsoLoginTicket"("providerId", "expiresAt");

ALTER TABLE "EnterpriseSsoProvider" ADD CONSTRAINT "EnterpriseSsoProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoProvider" ADD CONSTRAINT "EnterpriseSsoProvider_organizationId_defaultFacilityId_fkey" FOREIGN KEY ("organizationId", "defaultFacilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" ADD CONSTRAINT "EnterpriseSsoGroupRoleMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" ADD CONSTRAINT "EnterpriseSsoGroupRoleMapping_organizationId_providerId_fkey" FOREIGN KEY ("organizationId", "providerId") REFERENCES "EnterpriseSsoProvider"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" ADD CONSTRAINT "EnterpriseSsoGroupRoleMapping_organizationId_facilityId_fkey" FOREIGN KEY ("organizationId", "facilityId") REFERENCES "Facility"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" ADD CONSTRAINT "EnterpriseSsoGroupRoleMapping_organizationId_facilityId_zoneId_fkey" FOREIGN KEY ("organizationId", "facilityId", "zoneId") REFERENCES "FacilityZone"("organizationId", "facilityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoIdentity" ADD CONSTRAINT "EnterpriseSsoIdentity_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "EnterpriseSsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoIdentity" ADD CONSTRAINT "EnterpriseSsoIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoLoginRequest" ADD CONSTRAINT "EnterpriseSsoLoginRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "EnterpriseSsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoLoginTicket" ADD CONSTRAINT "EnterpriseSsoLoginTicket_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "EnterpriseSsoProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSsoLoginTicket" ADD CONSTRAINT "EnterpriseSsoLoginTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The Data API never receives enterprise configuration, assertions, or login
-- ticket material. The Cloud Run API remains the only access path.
ALTER TABLE "EnterpriseSsoProvider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoProvider" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoGroupRoleMapping" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoLoginRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoLoginRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoLoginTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnterpriseSsoLoginTicket" FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "EnterpriseSsoProvider", "EnterpriseSsoGroupRoleMapping", "EnterpriseSsoIdentity", "EnterpriseSsoLoginRequest", "EnterpriseSsoLoginTicket" TO stadium_api;
CREATE POLICY enterprise_sso_provider_scope ON "EnterpriseSsoProvider" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", NULL, NULL))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", NULL, NULL)));
CREATE POLICY enterprise_sso_group_mapping_scope ON "EnterpriseSsoGroupRoleMapping" FOR ALL TO stadium_api USING ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId"))) WITH CHECK ((SELECT app_private.scope_matches("organizationId", "facilityId", "zoneId")));
CREATE POLICY enterprise_sso_identity_own_scope ON "EnterpriseSsoIdentity" FOR SELECT TO stadium_api USING ("userId" = (SELECT app_private.current_user_id()));
CREATE POLICY enterprise_sso_identity_admin_scope ON "EnterpriseSsoIdentity" FOR ALL TO stadium_api USING (EXISTS (SELECT 1 FROM "EnterpriseSsoProvider" provider WHERE provider."id" = "EnterpriseSsoIdentity"."providerId" AND (SELECT app_private.scope_matches(provider."organizationId", NULL, NULL)) AND (SELECT app_private.can_manage_memberships()))) WITH CHECK (EXISTS (SELECT 1 FROM "EnterpriseSsoProvider" provider WHERE provider."id" = "EnterpriseSsoIdentity"."providerId" AND (SELECT app_private.scope_matches(provider."organizationId", NULL, NULL)) AND (SELECT app_private.can_manage_memberships())));

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "EnterpriseSsoProvider", "EnterpriseSsoGroupRoleMapping", "EnterpriseSsoIdentity", "EnterpriseSsoLoginRequest", "EnterpriseSsoLoginTicket" FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
