import { Body, Controller, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from './auth/public.decorator';
import { assertWithinSharedRateLimit } from './common/rate-limit';
import { getClientIp } from './common/http';
import { EmailService } from './email/email.service';
import { PrismaService } from './prisma/prisma.service';

const SUPPORT_RATE_LIMIT_MAX = 5;
const SUPPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const SUPPORT_RECIPIENT = 'admin@venuewrangler.com';

class SupportContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  topic?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;

  // Honeypot field. Real users never see/fill this.
  @IsOptional()
  @IsString()
  @MaxLength(0)
  website?: string;
}

@Controller('v1/support')
export class SupportController {
  constructor(
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('contact')
  async contact(@Req() request: Request, @Body() body: SupportContactDto) {
    await assertWithinSharedRateLimit(
      this.prisma,
      `support-contact:${getClientIp(request)}`,
      SUPPORT_RATE_LIMIT_MAX,
      SUPPORT_RATE_LIMIT_WINDOW_MS,
      'Too many support messages. Try again later.',
    );

    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const businessName = body.businessName?.trim() || 'Not provided';
    // Topics reach the email subject line; strip control characters so a
    // crafted topic cannot smuggle extra headers (CRLF injection) into it.
    const topic = (body.topic ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim() || 'General support';
    const message = body.message.trim();

    await this.email.sendOrThrow({
      to: SUPPORT_RECIPIENT,
      replyTo: email,
      subject: `Venue Wrangler support: ${topic}`,
      text: [
        'New Venue Wrangler support request',
        '',
        `Name: ${name}`,
        `Email: ${email}`,
        `Business: ${businessName}`,
        `Topic: ${topic}`,
        `IP: ${getClientIp(request)}`,
        '',
        message,
      ].join('\n'),
    });

    return { ok: true };
  }
}
