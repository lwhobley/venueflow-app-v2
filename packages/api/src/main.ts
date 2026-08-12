import 'reflect-metadata';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { jsonBodyLimitForPath } from './common/body-limit';
import { initSentry } from './observability/sentry';
import { DEFAULT_CORS_ORIGINS, isAllowedOrigin } from './common/cors-origin';

async function bootstrap() {
  // Error tracking — no-op unless SENTRY_DSN is set.
  initSentry();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  // Behind the platform's proxy: trust exactly as many hops as sit in front of
  // this process so req.ip reflects the real client (used for rate-limit
  // keys), not the proxy — and so a client-supplied X-Forwarded-For entry
  // beyond that hop count can't be spoofed into req.ip. Configurable because
  // the actual hop count depends on the deployment topology; verify it against
  // the platform's proxy chain rather than assuming a single hop.
  const rawTrustProxyHops = config.get<string>('TRUST_PROXY_HOPS', '1');
  const trustProxyHops = Number(rawTrustProxyHops);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  if (process.env.NODE_ENV === 'production' && !config.get<string>('TRUST_PROXY_HOPS')) {
    console.warn('[Bootstrap] WARNING: TRUST_PROXY_HOPS is not explicitly configured in environment; defaulting to 1 for Cloud Run load balancer');
  }
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  // Only accept fully-qualified http(s) origins. In production, further
  // restrict to product domains and local Expo previews so a mis-set CORS_ORIGINS cannot
  // open credentialed browser access to an attacker origin.
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && isAllowedOrigin(origin, isProduction));
  const allowedOrigins = Array.from(
    new Set([
      ...DEFAULT_CORS_ORIGINS,
      ...(isProduction ? [] : origins),
      ...(isProduction ? origins.filter((o) => isAllowedOrigin(o, true)) : origins),
    ]),
  );

  app.use(helmet());
  const STRIPE_WEBHOOK_PATH = '/api/v1/billing/stripe/webhook';
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl ?? req.url ?? '';
    const path = url.split('?')[0].replace(/\/+$/, '');
    const limit = jsonBodyLimitForPath(path, config.get<string>('JSON_BODY_LIMIT', '16mb'));
    json({
      limit,
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        const urlInner = req.originalUrl ?? req.url ?? '';
        const pathInner = urlInner.split('?')[0].replace(/\/+$/, '');
        if (pathInner === STRIPE_WEBHOOK_PATH) {
          req.rawBody = buf;
        }
      },
    })(req, res, next);
  });
  app.use(urlencoded({ extended: true, limit: config.get<string>('URLENCODED_BODY_LIMIT', '1mb') }));
  // Fail closed: only origins explicitly listed (and production-filtered) are
  // allowed. Native mobile clients don't send an Origin header, so this does
  // not affect them; it only restricts browsers.
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const port = config.get<number>('PORT') ?? config.get<number>('API_PORT', 4000);
  await app.listen(port);
}

void bootstrap();
