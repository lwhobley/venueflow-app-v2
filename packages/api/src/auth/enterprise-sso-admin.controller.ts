import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { EnterpriseSsoProtocol, EnterpriseSsoProviderStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.guard';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_ENV_KEY = /^SSO_[A-Z0-9_]+$/;

class ProviderDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @Matches(PROVIDER_SLUG)
  slug!: string;

  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsEnum(EnterpriseSsoProtocol)
  protocol!: EnterpriseSsoProtocol;

  @IsOptional()
  @IsEnum(EnterpriseSsoProviderStatus)
  status?: EnterpriseSsoProviderStatus;

  @IsOptional()
  @IsString()
  defaultFacilityId?: string;

  @IsOptional()
  @IsBoolean()
  jitProvisioningEnabled?: boolean;

  @IsArray()
  @IsString({ each: true })
  allowedEmailDomains!: string[];

  @IsOptional()
  @IsString()
  groupClaim?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  postLoginRedirectUri?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.oidc)
  @IsUrl({ require_tld: false, require_protocol: true })
  oidcIssuer?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.oidc)
  @IsString()
  oidcClientId?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.oidc)
  @Matches(SECRET_ENV_KEY)
  clientSecretEnvKey?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.saml)
  @IsUrl({ require_tld: false, require_protocol: true })
  samlEntryPoint?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.saml)
  @IsString()
  samlIdpCertificate?: string;

  @ValidateIf((value) => value.protocol === EnterpriseSsoProtocol.saml)
  @IsString()
  samlServiceProviderIssuer?: string;
}

class GroupRoleMappingDto {
  @IsString()
  externalGroup!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  facilityId?: string;

  @IsOptional()
  @IsString()
  zoneId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class ProvisionIdentityDto {
  @IsString()
  subject!: string;

  @IsString()
  email!: string;
}

class UpdateProviderDto extends PartialType(ProviderDto) {}
class UpdateGroupRoleMappingDto extends PartialType(GroupRoleMappingDto) {}

@Controller('v1/enterprise-sso')
export class EnterpriseSsoAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sso: EnterpriseSsoService,
  ) {}

  @Get('organizations/:organizationId/providers')
  async listProviders(@CurrentUser() user: AuthUser, @Param('organizationId') organizationId: string) {
    await this.sso.assertOrganizationAdministrator(user.sub, organizationId);
    return this.prisma.enterpriseSsoProvider.findMany({
      where: { organizationId },
      include: { groupRoleMappings: { orderBy: [{ priority: 'desc' }, { externalGroup: 'asc' }] } },
      orderBy: { displayName: 'asc' },
    });
  }

  @Post('providers')
  async createProvider(@CurrentUser() user: AuthUser, @Body() body: ProviderDto) {
    await this.sso.assertOrganizationAdministrator(user.sub, body.organizationId);
    return this.prisma.enterpriseSsoProvider.create({
      data: {
        ...body,
        slug: body.slug.trim().toLowerCase(),
        allowedEmailDomains: this.normalizeDomains(body.allowedEmailDomains),
        groupClaim: body.groupClaim?.trim() || 'groups',
        status: body.status ?? EnterpriseSsoProviderStatus.draft,
      },
    });
  }

  @Patch('providers/:providerId')
  async updateProvider(@CurrentUser() user: AuthUser, @Param('providerId') providerId: string, @Body() body: UpdateProviderDto) {
    const existing = await this.prisma.enterpriseSsoProvider.findUniqueOrThrow({ where: { id: providerId } });
    await this.sso.assertOrganizationAdministrator(user.sub, existing.organizationId);
    if (body.organizationId && body.organizationId !== existing.organizationId) throw new BadRequestException('An SSO provider cannot be moved between organizations.');
    return this.prisma.enterpriseSsoProvider.update({
      where: { id: providerId },
      data: {
        ...body,
        organizationId: undefined,
        ...(body.slug ? { slug: body.slug.trim().toLowerCase() } : {}),
        ...(body.allowedEmailDomains ? { allowedEmailDomains: this.normalizeDomains(body.allowedEmailDomains) } : {}),
        ...(body.groupClaim ? { groupClaim: body.groupClaim.trim() } : {}),
      },
    });
  }

  @Post('providers/:providerId/group-role-mappings')
  async createGroupRoleMapping(@CurrentUser() user: AuthUser, @Param('providerId') providerId: string, @Body() body: GroupRoleMappingDto) {
    const provider = await this.prisma.enterpriseSsoProvider.findUniqueOrThrow({ where: { id: providerId } });
    await this.sso.assertOrganizationAdministrator(user.sub, provider.organizationId);
    return this.prisma.enterpriseSsoGroupRoleMapping.create({
      data: {
        ...body,
        providerId,
        organizationId: provider.organizationId,
        externalGroup: body.externalGroup.trim(),
        priority: body.priority ?? 0,
        active: body.active ?? true,
      },
    });
  }

  @Post('providers/:providerId/identities')
  async provisionIdentity(@CurrentUser() user: AuthUser, @Param('providerId') providerId: string, @Body() body: ProvisionIdentityDto) {
    const provider = await this.prisma.enterpriseSsoProvider.findUniqueOrThrow({ where: { id: providerId } });
    await this.sso.assertOrganizationAdministrator(user.sub, provider.organizationId);
    const email = body.email.trim().toLowerCase();
    const account = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!account) throw new BadRequestException('Create the Stadium Wrangler user before linking its enterprise identity.');
    return this.prisma.enterpriseSsoIdentity.upsert({
      where: { providerId_subject: { providerId, subject: body.subject.trim() } },
      create: { providerId, userId: account.id, subject: body.subject.trim(), email },
      update: { userId: account.id, email },
    });
  }

  @Patch('group-role-mappings/:mappingId')
  async updateGroupRoleMapping(@CurrentUser() user: AuthUser, @Param('mappingId') mappingId: string, @Body() body: UpdateGroupRoleMappingDto) {
    const mapping = await this.prisma.enterpriseSsoGroupRoleMapping.findUniqueOrThrow({ where: { id: mappingId } });
    await this.sso.assertOrganizationAdministrator(user.sub, mapping.organizationId);
    return this.prisma.enterpriseSsoGroupRoleMapping.update({
      where: { id: mappingId },
      data: {
        ...body,
        ...(body.externalGroup ? { externalGroup: body.externalGroup.trim() } : {}),
      },
    });
  }

  private normalizeDomains(domains: string[]) {
    const normalized = domains.map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (!normalized.length) throw new BadRequestException('At least one allowed email domain is required.');
    return Array.from(new Set(normalized));
  }
}
