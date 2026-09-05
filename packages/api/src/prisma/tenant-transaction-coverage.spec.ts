import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every controller must make a deliberate choice about
 * `TenantRequestTransactionInterceptor`, which binds the request to a
 * GUC-carrying transaction so PostgreSQL RLS — not just the app-layer Prisma
 * extension — enforces tenant isolation.
 *
 * It is not applied globally on purpose: it holds one pool connection for the
 * whole request, and the production pool is small, so a route that makes an
 * external call mid-handler (S3, Stripe, email, an AI provider) would hold a
 * connection idle for that call. See tenant-request-transaction.interceptor.ts.
 *
 * The controllers below are therefore documented exceptions rather than
 * oversights. Each needs per-route analysis — applying the interceptor and
 * marking the externally-calling routes `@SkipTenantTransaction()` — before it
 * can move out of this list. The list may shrink; it must never grow silently.
 */
const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
  'app-billing.controller.ts': 'Stripe calls in the request path',
  'app-staff.controller.ts': 'staff import parser performs external parsing work',
  'app.controller.ts': 'health/bootstrap routes and staff import parsing',
  'bar-inventory.controller.ts': 'inventory parser performs external parsing work',
  'chat.controller.ts': 'S3 image upload in the request path',
  'documents.controller.ts': 'S3 document upload/download in the request path',
  'operations.controller.ts': 'injects S3ImageService for media upload routes',
  'pos.controller.ts': 'outbound POS provider calls in the request path',
  'scheduling.controller.ts': 'AI scheduler provider calls in the request path',
  'workforce.controller.ts': 'injects EmailService for invite/notification routes',
};

const MODULES_DIR = join(__dirname, '..', 'modules');

function controllerFiles(): { name: string; source: string }[] {
  const found: { name: string; source: string }[] = [];
  for (const moduleName of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!moduleName.isDirectory()) continue;
    const moduleDir = join(MODULES_DIR, moduleName.name);
    for (const entry of readdirSync(moduleDir)) {
      if (!entry.endsWith('.controller.ts')) continue;
      found.push({ name: entry, source: readFileSync(join(moduleDir, entry), 'utf8') });
    }
  }
  return found;
}

describe('tenant request transaction coverage', () => {
  const controllers = controllerFiles();

  it('finds the controllers to audit', () => {
    expect(controllers.length).toBeGreaterThan(20);
  });

  it('has every controller either covered by the interceptor or documented', () => {
    const undocumented = controllers
      .filter((c) => !c.source.includes('TenantRequestTransactionInterceptor'))
      .map((c) => c.name)
      .filter((name) => !(name in DOCUMENTED_EXCEPTIONS));

    expect(undocumented).toEqual([]);
  });

  it('keeps the exception list free of controllers that are already covered', () => {
    const stale = controllers
      .filter((c) => c.source.includes('TenantRequestTransactionInterceptor'))
      .map((c) => c.name)
      .filter((name) => name in DOCUMENTED_EXCEPTIONS);

    expect(stale).toEqual([]);
  });

  it('does not list an exception for a controller that no longer exists', () => {
    const names = new Set(controllers.map((c) => c.name));
    const orphaned = Object.keys(DOCUMENTED_EXCEPTIONS).filter((name) => !names.has(name));
    expect(orphaned).toEqual([]);
  });

  it('gives a reason for every documented exception', () => {
    for (const [name, reason] of Object.entries(DOCUMENTED_EXCEPTIONS)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
    }
  });
});
