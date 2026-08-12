import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnterpriseSsoProtocol, EnterpriseSsoProviderStatus, Prisma, Role } from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'crypto';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import { ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider, Profile as SamlProfile } from '@node-saml/node-saml';
import type { VerifiedCallback } from '@node-saml/passport-saml/lib/types';
import { Authenticator } from 'passport';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminRole } from './roles';

const LOGIN_REQUEST_TTL_MS = 10 * 60 * 1000;
const LOGIN_TICKET_TTL_MS = 5 * 60 * 1000;
const PROVIDER_SECRET_KEY = /^SSO_[A-Z0-9_]+$/;

type Provider = Prisma.EnterpriseSsoProviderGetPayload<{
  include: { organization: { select: { code: true } }; groupRoleMappings: true };
}>;

export type EnterprisePrincipal = {
  subject: string;
  email: string;
  groups: string[];
  emailVerified: boolean;
};

class DatabaseSamlRequestCache implements CacheProvider {
  constructor(private readonly prisma: PrismaService, private readonly providerId: string) {}

  async saveAsync(key: string, value: string) {
    const createdAt = Date.now();
    await this.prisma.enterpriseSsoLoginRequest.upsert({
      where: { samlRequestId: key },
      create: {
        providerId: this.providerId,
        samlRequestId: key,
        expiresAt: new Date(createdAt + LOGIN_REQUEST_TTL_MS),
      },
      update: { expiresAt: new Date(createdAt + LOGIN_REQUEST_TTL_MS), consumedAt: null },
    });
    return { value, createdAt };
  }

  async getAsync(key: string) {
    const request = await this.prisma.enterpriseSsoLoginRequest.findUnique({
      where: { samlRequestId: key },
      select: { expiresAt: true, consumedAt: true },
    });
    if (!request || request.consumedAt || request.expiresAt <= new Date()) return null;
    return key;
  }

  async removeAsync(key: string | null) {
    if (!key) return null;
    const updated = await this.prisma.enterpriseSsoLoginRequest.updateMany({
      where: { samlRequestId: key, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return updated.count ? key : null;
  }
}

@Injectable()
export class EnterpriseSsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findActiveProvider(organizationCode: string, slug: string): Promise<Provider> {
    const provider = await this.prisma.enterpriseSsoProvider.findFirst({
      where: {
        slug,
        status: EnterpriseSsoProviderStatus.active,
        organization: { code: organizationCode },
      },
      include: {
        organization: { select: { code: true } },
        groupRoleMappings: { where: { active: true }, orderBy: { priority: 'desc' } },
      },
    });
    if (!provider) throw new NotFoundException('The requested SSO provider is not available.');
    return provider;
  }

  async assertOrganizationAdministrator(userId: string, organizationId: string) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true, status: true },
    });
    if (!membership || membership.status !== 'active' || !isAdminRole(membership.role)) {
      throw new ForbiddenException('Organization administrator access is required.');
    }
  }

  getCallbackUrl(provider: Pick<Provider, 'slug'> & { organization: { code: string } }): string {
    const apiBaseUrl = this.config.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '');
    if (!apiBaseUrl || !/^https:\/\//i.test(apiBaseUrl)) {
      throw new Error('API_PUBLIC_URL must be an HTTPS URL before enterprise SSO can be enabled.');
    }
    const organizationCode = provider.organization.code;
    return `${apiBaseUrl}/api/v1/auth/sso/${encodeURIComponent(organizationCode)}/${encodeURIComponent(provider.slug)}/callback`;
  }

  getOidcCallbackUrl(provider: Provider, request: Request): string {
    const callback = new URL(this.getCallbackUrl(provider));
    const received = new URL(request.originalUrl ?? request.url, 'https://sso.invalid');
    callback.search = received.search;
    return callback.href;
  }

  async beginOidc(provider: Provider): Promise<string> {
    this.assertOidcConfiguration(provider);
    const oidc = await this.oidc();
    const state = oidc.randomState();
    const nonce = this.nonce(state);
    const codeVerifier = this.codeVerifier(state);
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    await this.prisma.enterpriseSsoLoginRequest.create({
      data: {
        providerId: provider.id,
        stateHash: this.hash(state),
        nonceHash: this.hash(nonce),
        expiresAt: new Date(Date.now() + LOGIN_REQUEST_TTL_MS),
      },
    });
    const client = await oidc.discovery(
      new URL(provider.oidcIssuer!),
      provider.oidcClientId!,
      this.resolveProviderSecret(provider),
    );
    return oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.getCallbackUrl(provider),
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).href;
  }

  async completeOidc(provider: Provider, callbackUrl: string): Promise<EnterprisePrincipal> {
    this.assertOidcConfiguration(provider);
    const callback = new URL(callbackUrl);
    const state = callback.searchParams.get('state');
    if (!state) throw new UnauthorizedException('The SSO response is missing state.');
    const request = await this.prisma.enterpriseSsoLoginRequest.findUnique({
      where: { stateHash: this.hash(state) },
    });
    if (!request || request.providerId !== provider.id || request.consumedAt || request.expiresAt <= new Date()) {
      throw new UnauthorizedException('This SSO request is expired or has already been used.');
    }
    const claim = await this.prisma.enterpriseSsoLoginRequest.updateMany({
      where: { id: request.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claim.count !== 1) throw new UnauthorizedException('This SSO request has already been used.');

    const oidc = await this.oidc();
    const client = await oidc.discovery(
      new URL(provider.oidcIssuer!),
      provider.oidcClientId!,
      this.resolveProviderSecret(provider),
    );
    const tokens = await oidc.authorizationCodeGrant(client, callback, {
      expectedState: state,
      expectedNonce: this.nonce(state),
      pkceCodeVerifier: this.codeVerifier(state),
    });
    const claims = tokens.claims();
    if (!claims?.sub || typeof claims.email !== 'string' || claims.email_verified !== true) {
      throw new UnauthorizedException('The identity provider did not return a verified email identity.');
    }
    return {
      subject: claims.sub,
      email: claims.email,
      groups: this.groupsFromClaims(claims, provider.groupClaim),
      emailVerified: true,
    };
  }

  beginSaml(provider: Provider, request: Request, response: Response): void {
    const strategy = this.samlStrategy(provider);
    const passport = new Authenticator();
    // passport-saml currently bundles Express 4 typings while this API uses
    // Express 5 typings. The runtime Passport strategy contract is identical.
    passport.use(strategy as unknown as import('passport').Strategy);
    passport.authenticate(strategy.name, { session: false })(request, response, (error?: Error) => {
      if (error) throw error;
    });
  }

  async completeSaml(provider: Provider, request: Request, response: Response): Promise<EnterprisePrincipal> {
    const strategy = this.samlStrategy(provider);
    const passport = new Authenticator();
    passport.use(strategy as unknown as import('passport').Strategy);
    return new Promise<EnterprisePrincipal>((resolve, reject) => {
      passport.authenticate(strategy.name, { session: false }, (error: Error | null, user?: EnterprisePrincipal) => {
        if (error) return reject(error);
        if (!user) return reject(new UnauthorizedException('SAML authentication was not completed.'));
        resolve(user);
      })(request, response, (error?: Error) => error ? reject(error) : undefined);
    });
  }

  async authenticatePrincipal(provider: Provider, principal: EnterprisePrincipal) {
    const email = principal.email.trim().toLowerCase();
    if (!principal.emailVerified || !this.isAllowedEmail(provider, email)) {
      throw new ForbiddenException('This identity is not authorized for the configured enterprise domain.');
    }
    const mapping = this.resolveMapping(provider, principal.groups);
    const facilityId = mapping.facilityId ?? provider.defaultFacilityId;
    if (!facilityId) throw new ForbiddenException('This SSO mapping does not have a facility assignment.');

    const result = await this.prisma.$transaction(async (tx) => {
      const venue = await tx.venue.findFirst({
        where: { id: facilityId, organizationId: provider.organizationId },
        select: { id: true, name: true },
      });
      if (!venue) throw new ForbiddenException('The mapped facility is not available.');

      let identity = await tx.enterpriseSsoIdentity.findUnique({
        where: { providerId_subject: { providerId: provider.id, subject: principal.subject } },
        select: { userId: true },
      });
      let userId = identity?.userId;
      if (!userId) {
        if (!provider.jitProvisioningEnabled) {
          throw new ForbiddenException('Your SSO identity has not been provisioned for this organization.');
        }
        const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
        const user = existingUser ?? await tx.user.create({
          data: { email, emailVerifiedAt: new Date() },
          select: { id: true },
        });
        userId = user.id;
        identity = await tx.enterpriseSsoIdentity.create({
          data: { providerId: provider.id, userId, subject: principal.subject, email },
          select: { userId: true },
        });
      } else {
        await tx.enterpriseSsoIdentity.update({
          where: { providerId_subject: { providerId: provider.id, subject: principal.subject } },
          data: { email, lastAuthenticatedAt: new Date() },
        });
      }

      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: provider.organizationId, userId } },
        create: { organizationId: provider.organizationId, userId, role: mapping.role, status: 'active' },
        update: { role: mapping.role, status: 'active' },
      });
      const membership = await tx.organizationMembership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: provider.organizationId, userId } },
        select: { id: true },
      });
      const existingScope = await tx.scopeAssignment.findFirst({
        where: { membershipId: membership.id, facilityId, zoneId: mapping.zoneId ?? null, active: true },
        select: { id: true },
      });
      if (!existingScope) {
        await tx.scopeAssignment.create({
          data: { organizationId: provider.organizationId, membershipId: membership.id, facilityId, zoneId: mapping.zoneId ?? null },
        });
      }

      let profile = await tx.profile.findFirst({ where: { userId, venueId: venue.id } });
      if (profile) {
        profile = await tx.profile.update({
          where: { id: profile.id },
          data: { email, role: mapping.role, membershipStatus: 'active', allAccess: false },
          include: { venue: true },
        });
      } else {
        profile = await tx.profile.create({
          data: { userId, email, fullName: email.split('@')[0] || 'Enterprise User', role: mapping.role, jobTitle: mapping.role.replaceAll('_', ' '), venueId: venue.id, membershipStatus: 'active' },
          include: { venue: true },
        });
      }
      await tx.auditLog.create({
        data: {
          venueId: venue.id,
          actorProfileId: null,
          actorName: 'Enterprise SSO',
          actorRole: mapping.role,
          targetProfileId: profile.id,
          targetName: profile.fullName,
          targetRole: mapping.role,
          entityType: 'enterprise_sso_identity',
          entityId: provider.id,
          action: 'enterprise_sso_role_mapped',
          summary: `Enterprise SSO mapped a signed identity to ${mapping.role}.`,
          metadata: { providerId: provider.id, mappingId: mapping.id, protocol: provider.protocol },
        },
      });
      return { userId, profile };
    });
    return result;
  }

  async createLoginTicket(providerId: string, userId: string, profileId: string) {
    const secret = randomBytes(32).toString('base64url');
    await this.prisma.enterpriseSsoLoginTicket.create({
      data: { providerId, userId, profileId, secretHash: this.hash(secret), expiresAt: new Date(Date.now() + LOGIN_TICKET_TTL_MS) },
    });
    return secret;
  }

  async consumeLoginTicket(secret: string) {
    const ticket = await this.prisma.enterpriseSsoLoginTicket.findUnique({
      where: { secretHash: this.hash(secret) },
      select: { id: true, userId: true, profileId: true, expiresAt: true, consumedAt: true },
    });
    if (!ticket || ticket.consumedAt || ticket.expiresAt <= new Date()) throw new UnauthorizedException('This SSO sign-in code is invalid or expired.');
    const claim = await this.prisma.enterpriseSsoLoginTicket.updateMany({
      where: { id: ticket.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claim.count !== 1) throw new UnauthorizedException('This SSO sign-in code has already been used.');
    const profile = await this.prisma.profile.findFirst({ where: { id: ticket.profileId, userId: ticket.userId }, include: { venue: true } });
    if (!profile || profile.membershipStatus === 'revoked' || profile.membershipStatus === 'rejected') throw new UnauthorizedException('This SSO account is no longer active.');
    return { userId: ticket.userId, profile };
  }

  private samlStrategy(provider: Provider) {
    this.assertSamlConfiguration(provider);
    return new SamlStrategy({
      entryPoint: provider.samlEntryPoint!,
      callbackUrl: this.getCallbackUrl(provider),
      issuer: provider.samlServiceProviderIssuer!,
      idpCert: provider.samlIdpCertificate!,
      identifierFormat: null,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: LOGIN_REQUEST_TTL_MS,
      cacheProvider: new DatabaseSamlRequestCache(this.prisma, provider.id),
    }, (profile: SamlProfile | null, done: VerifiedCallback) => {
      try {
        if (!profile?.nameID) return done(new Error('SAML assertion is missing a subject.'));
        const email = typeof profile.email === 'string' ? profile.email : typeof profile.mail === 'string' ? profile.mail : '';
        if (!email) return done(new Error('SAML assertion is missing an email.'));
        return done(null, {
          subject: profile.nameID,
          email,
          groups: this.groupsFromClaims(profile as Record<string, unknown>, provider.groupClaim),
          emailVerified: true,
        });
      } catch (error) {
        return done(error instanceof Error ? error : new Error('Invalid SAML assertion.'));
      }
    }, (_profile: SamlProfile | null, done: VerifiedCallback) => done(new Error('SAML logout is not supported.')));
  }

  private resolveMapping(provider: Provider, groups: string[]) {
    const groupSet = new Set(groups.map((group) => group.trim().toLocaleLowerCase()).filter(Boolean));
    const matches = provider.groupRoleMappings.filter((mapping) => groupSet.has(mapping.externalGroup.trim().toLocaleLowerCase()));
    if (!matches.length) throw new ForbiddenException('No active Stadium Wrangler role mapping exists for this enterprise group.');
    const topPriority = matches[0].priority;
    const top = matches.filter((mapping) => mapping.priority === topPriority);
    const distinctAssignments = new Set(top.map((mapping) => `${mapping.role}:${mapping.facilityId ?? ''}:${mapping.zoneId ?? ''}`));
    if (distinctAssignments.size > 1) throw new ForbiddenException('The enterprise group mapping has an ambiguous highest-priority assignment.');
    return top[0];
  }

  private isAllowedEmail(provider: Provider, email: string) {
    const domain = email.split('@')[1]?.toLocaleLowerCase();
    return Boolean(domain && provider.allowedEmailDomains.map((value) => value.trim().toLocaleLowerCase().replace(/^@/, '')).includes(domain));
  }

  private groupsFromClaims(claims: Record<string, unknown>, groupClaim: string): string[] {
    const raw = claims[groupClaim];
    if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
    if (typeof raw === 'string') return raw.split(',').map((value) => value.trim()).filter(Boolean);
    return [];
  }

  private assertOidcConfiguration(provider: Provider) {
    if (provider.protocol !== EnterpriseSsoProtocol.oidc || !provider.oidcIssuer || !provider.oidcClientId || !provider.clientSecretEnvKey) {
      throw new NotFoundException('The requested OIDC provider is not configured.');
    }
  }

  private assertSamlConfiguration(provider: Provider) {
    if (provider.protocol !== EnterpriseSsoProtocol.saml || !provider.samlEntryPoint || !provider.samlIdpCertificate || !provider.samlServiceProviderIssuer) {
      throw new NotFoundException('The requested SAML provider is not configured.');
    }
  }

  private resolveProviderSecret(provider: Provider): string {
    if (!provider.clientSecretEnvKey || !PROVIDER_SECRET_KEY.test(provider.clientSecretEnvKey)) throw new Error('The SSO provider secret reference is invalid.');
    const secret = this.config.get<string>(provider.clientSecretEnvKey);
    if (!secret) throw new Error(`SSO provider secret ${provider.clientSecretEnvKey} is not configured.`);
    return secret;
  }

  private codeVerifier(state: string) {
    const secret = this.config.get<string>('SSO_STATE_SECRET');
    if (!secret || secret.length < 32) throw new Error('SSO_STATE_SECRET must be configured with at least 32 characters.');
    return createHmac('sha256', secret).update(state).digest('base64url');
  }

  private nonce(state: string) {
    const secret = this.config.get<string>('SSO_STATE_SECRET');
    if (!secret || secret.length < 32) throw new Error('SSO_STATE_SECRET must be configured with at least 32 characters.');
    return createHmac('sha256', secret).update(`nonce:${state}`).digest('base64url');
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async oidc(): Promise<typeof import('openid-client')> {
    // openid-client is ESM-only while this Nest API is CommonJS. Keep the
    // native dynamic import intact instead of transpiling it to require().
    return new Function('specifier', 'return import(specifier)')('openid-client') as Promise<typeof import('openid-client')>;
  }
}
