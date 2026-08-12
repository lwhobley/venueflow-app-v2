# Enterprise SSO

Stadium Wrangler supports enterprise SSO through Passport SAML 2.0 and standards-compliant OpenID Connect Authorization Code + PKCE. Each provider belongs to one organization and maps signed IdP group claims to a Stadium Wrangler role and optional facility/zone scope.

## Required Cloud Run configuration

Set these non-secret variables on `stadium-wrangler-api`:

```text
API_PUBLIC_URL=https://<your-api-host>
```

Store `SSO_STATE_SECRET` as a Google Secret Manager value and mount it as the `SSO_STATE_SECRET` environment variable. It must be at least 32 random characters. For every OIDC provider, create a separate Secret Manager secret and mount it using an environment variable named `SSO_<PROVIDER>_CLIENT_SECRET`.

Client secrets are never accepted by the admin API or stored in PostgreSQL. The provider record only stores the environment-variable name.

## Provider setup

An organization administrator creates a provider through `POST /api/v1/enterprise-sso/providers`, then creates group mappings using `POST /api/v1/enterprise-sso/providers/:providerId/group-role-mappings`. Keep the provider in `draft` until its IdP configuration and mappings are verified; PostgreSQL rejects an `active` provider with incomplete protocol configuration.

For OIDC (Azure AD / Entra ID or Okta), configure the IdP redirect URI as:

```text
https://<your-api-host>/api/v1/auth/sso/<organization-code>/<provider-slug>/callback
```

Use the provider's issuer URL, client ID, and the Cloud Run secret environment-variable name. The API performs issuer discovery, Authorization Code flow, PKCE S256, state validation, nonce validation, audience validation, and ID-token signature validation through `openid-client`.

For SAML, configure the IdP ACS URL to the same callback URL and configure the Service Provider Entity ID to the value stored as `samlServiceProviderIssuer`. The API requires a signed assertion or signed response and validates `InResponseTo` against a database-backed, expiring request cache.

## Group mapping examples

| Enterprise group | Stadium Wrangler role | Scope |
| --- | --- | --- |
| `Concourse Supervisors` | `concourse_supervisor` | Facility A, North Concourse |
| `Suite Managers` | `suite_manager` | Facility A, Premium Zone |
| `External Auditors` | `auditor` | Facility A, all zones |

Mappings carry a priority. When a person is in multiple groups, the highest-priority mapping is used. If different assignments tie at the highest priority, sign-in is denied until an administrator resolves the ambiguity.

## Provisioning and safety defaults

- JIT provisioning is off by default. With it off, an administrator must create the Stadium Wrangler user and link the IdP subject with `POST /api/v1/enterprise-sso/providers/:providerId/identities` before the first sign-in.
- Every active provider must list allowed email domains. Unverified OIDC email claims and non-allowed domains are denied.
- The callback returns a five-minute, single-use sign-in ticket. When a `postLoginRedirectUri` is configured, the ticket is put in the URL fragment rather than query string to avoid server/referrer leakage. The client exchanges it via `POST /api/v1/auth/sso/exchange` for the normal revocable Stadium Wrangler session JWT.
- Each SSO role assignment is written to the venue audit log. Raw SAML/OIDC assertions, tokens, client secrets, and group payloads are not logged.

## Rollout checklist

1. Apply Prisma migration `20260812140000_enterprise_sso_rbac`.
2. Add `API_PUBLIC_URL`, `SSO_STATE_SECRET`, and provider-specific `SSO_*_CLIENT_SECRET` secrets to Cloud Run.
3. Register the callback URL in Azure AD/Okta and configure its group claim.
4. Create the provider as `draft`, add allowed email domains and group mappings, then promote it to `active`.
5. Test with a user assigned to exactly one mapped group, a user with an unmapped group, and a user with conflicting highest-priority groups.
