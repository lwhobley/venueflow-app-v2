import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { runWithoutTenant } from '../prisma/tenant-context';
import { setupTestDb } from './setup-test-db';

/**
 * Boots the REAL Nest application (full module graph, real guards, real
 * ValidationPipe/exception filter — the same wiring as main.ts, minus
 * app.listen()) against a real Postgres test database, so tests exercise the
 * actual HTTP request path instead of calling controller methods directly.
 */
export async function bootstrapE2eApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  jwt: JwtService;
  teardown: () => Promise<void>;
}> {
  let dbTeardown: () => Promise<void> = async () => {};
  // Snapshot every env var we mutate so teardown can restore the exact prior
  // state (including "was unset"). Without this, this bootstrap leaks
  // DATABASE_URL et al. onto the shared process.env — safe today only because
  // vitest's default fork pool isolates files, but a fragile implicit
  // dependency on that pool config.
  const ENV_KEYS = ['DATABASE_URL', 'JWT_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'] as const;
  const envSnapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) envSnapshot[key] = process.env[key];
  const restoreEnv = () => {
    for (const key of ENV_KEYS) {
      if (envSnapshot[key] === undefined) delete process.env[key];
      else process.env[key] = envSnapshot[key];
    }
  };

  const db = await setupTestDb();
  dbTeardown = db.teardown;
  process.env.DATABASE_URL = db.url;

  // Boot-time required env vars — same placeholders api-ci.yml already sets;
  // fall back to safe test values so this also runs from a bare `npm test`.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = 'e2e-test-jwt-secret-at-least-32-chars-long';
  }
  process.env.AWS_ACCESS_KEY_ID ??= 'e2e-test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'e2e-test-secret-key';
  process.env.AWS_S3_BUCKET ??= 'e2e-test-bucket';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // Mirrors main.ts's request-shaping (minus helmet/CORS/body-size tuning,
  // which don't affect the auth/billing/route behavior these smoke tests
  // exercise).
  app.use((_req: any, _res: any, next: any) => runWithoutTenant(() => next()));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api', { exclude: ['/'] });

  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  return {
    app,
    prisma,
    jwt,
    teardown: async () => {
      await app.close();
      await dbTeardown();
      restoreEnv();
    },
  };
}

/** Mint a JWT shaped like the real login flow's AuthUser payload. */
export function signTestToken(
  jwt: JwtService,
  payload: { sub: string; sid: string; venueId?: string | null; profileId?: string; role?: string },
) {
  return jwt.sign(payload);
}
