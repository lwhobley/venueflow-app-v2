import { Body, Controller, Get, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsString, Matches, MinLength } from 'class-validator';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './public.decorator';
import { EnterprisePrincipal, EnterpriseSsoService } from './enterprise-sso.service';

class ExchangeSsoTicketDto {
  @IsString()
  @MinLength(32)
  code!: string;
}

@Controller('v1/auth/sso')
export class EnterpriseSsoController {
  constructor(
    private readonly sso: EnterpriseSsoService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Get(':organizationCode/:providerSlug/start')
  async start(
    @Param('organizationCode') organizationCode: string,
    @Param('providerSlug') providerSlug: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const provider = await this.sso.findActiveProvider(organizationCode, providerSlug);
    if (provider.protocol === 'oidc') {
      response.redirect(302, await this.sso.beginOidc(provider));
      return;
    }
    this.sso.beginSaml(provider, request, response);
  }

  @Public()
  @Get(':organizationCode/:providerSlug/callback')
  async oidcCallback(
    @Param('organizationCode') organizationCode: string,
    @Param('providerSlug') providerSlug: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const provider = await this.sso.findActiveProvider(organizationCode, providerSlug);
    if (provider.protocol !== 'oidc') throw new UnauthorizedException('This SSO provider uses SAML POST binding.');
    const principal = await this.sso.completeOidc(provider, this.sso.getOidcCallbackUrl(provider, request));
    await this.complete(provider, principal, response);
  }

  @Public()
  @Post(':organizationCode/:providerSlug/callback')
  async samlCallback(
    @Param('organizationCode') organizationCode: string,
    @Param('providerSlug') providerSlug: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const provider = await this.sso.findActiveProvider(organizationCode, providerSlug);
    if (provider.protocol !== 'saml') throw new UnauthorizedException('This SSO provider uses OIDC redirect binding.');
    const principal = await this.sso.completeSaml(provider, request, response);
    await this.complete(provider, principal, response);
  }

  @Public()
  @Post('exchange')
  async exchange(@Body() body: ExchangeSsoTicketDto) {
    const { userId, profile } = await this.sso.consumeLoginTicket(body.code);
    const session = await this.prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    const token = await this.jwt.signAsync({
      sub: userId,
      email: profile.email,
      name: profile.fullName,
      sid: session.id,
      profileId: profile.id,
      venueId: profile.venueId,
      venueName: profile.venue?.name ?? null,
      role: profile.role,
      allAccess: profile.allAccess,
      trialEndsAt: profile.trialEndsAt?.toISOString() ?? null,
      venueStatus: profile.venue?.subscriptionStatus ?? null,
    });
    await this.prisma.session.update({ where: { id: session.id }, data: { tokenHash: createHash('sha256').update(token).digest('hex') } });
    return {
      token,
      profile: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        venueId: profile.venueId,
        allAccess: profile.allAccess,
      },
      venue: profile.venue ? { id: profile.venue.id, name: profile.venue.name } : null,
      venues: profile.venue ? [{ id: profile.venue.id, name: profile.venue.name, role: profile.role, profileId: profile.id }] : [],
    };
  }

  private async complete(provider: Awaited<ReturnType<EnterpriseSsoService['findActiveProvider']>>, principal: EnterprisePrincipal, response: Response) {
    const { userId, profile } = await this.sso.authenticatePrincipal(provider, principal);
    const ticket = await this.sso.createLoginTicket(provider.id, userId, profile.id);
    if (!provider.postLoginRedirectUri) return response.status(200).json({ code: ticket, expiresInSeconds: 300 });
    const redirect = new URL(provider.postLoginRedirectUri);
    // A fragment is intentionally used so this one-time code is not sent in
    // the redirect request or included in downstream server request logs.
    redirect.hash = new URLSearchParams({ sso_ticket: ticket }).toString();
    return response.redirect(302, redirect.href);
  }
}
