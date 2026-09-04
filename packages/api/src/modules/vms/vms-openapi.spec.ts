import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Documentation drift guard.
 *
 * The OpenAPI spec is hand-maintained (the API does not ship @nestjs/swagger),
 * so nothing stops it from falling behind the controller. This test compares
 * the two and fails when a route is added, removed or renamed without the spec
 * following, which is what keeps section 7.1 honest over time.
 *
 * The spec is read line-by-line rather than through a YAML library: the only
 * YAML parser in the tree is a transitive dependency with no bundled types, and
 * a drift guard is not worth taking a new dependency for. The structure being
 * read — path keys at one indent, method keys at the next — is fixed by the
 * OpenAPI format itself.
 */
describe('VMS OpenAPI spec', () => {
  const controllerSource = readFileSync(join(__dirname, 'vms.controller.ts'), 'utf-8');
  const specPath = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'vms', 'openapi.yaml');
  const specText = readFileSync(specPath, 'utf-8');
  const specLines = specText.split('\n');

  /** `orders/:id/bids` → `get /v1/vms/orders/{id}/bids` */
  const declaredRoutes = Array.from(
    controllerSource.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g),
  ).map((match) => ({
    method: match[1].toLowerCase(),
    path: '/v1/vms/' + match[2].replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
  }));

  const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  /** Walk the `paths:` block, collecting `method path` for each operation. */
  const specOperations = new Set<string>();
  {
    let inPaths = false;
    let currentPath: string | null = null;

    for (const line of specLines) {
      if (/^paths:\s*$/.test(line)) {
        inPaths = true;
        continue;
      }
      if (!inPaths) continue;
      // A non-indented key ends the paths block.
      if (/^[A-Za-z]/.test(line)) break;

      const pathMatch = line.match(/^ {2}(\/[^\s:]*):\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[1];
        continue;
      }

      const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
      if (methodMatch && currentPath && HTTP_METHODS.includes(methodMatch[1])) {
        specOperations.add(`${methodMatch[1]} ${currentPath}`);
      }
    }
  }

  it('parses both sides of the comparison', () => {
    expect(declaredRoutes.length).toBeGreaterThan(40);
    expect(specOperations.size).toBeGreaterThan(40);
  });

  it('is an OpenAPI 3.1 document with security and servers declared', () => {
    expect(specText).toMatch(/^openapi: 3\.1/m);
    expect(specText).toContain('Vendor Management System');
    expect(specText).toMatch(/bearerAuth:\s*\n\s+type: http\s*\n\s+scheme: bearer/);
    expect(specText).toMatch(/^servers:/m);
  });

  it('documents every route the controller exposes', () => {
    const undocumented = declaredRoutes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !specOperations.has(key));

    expect(undocumented).toEqual([]);
  });

  it('does not document routes that no longer exist', () => {
    const declared = new Set(declaredRoutes.map((route) => `${route.method} ${route.path}`));
    const stale = Array.from(specOperations).filter((key) => !declared.has(key));

    expect(stale).toEqual([]);
  });

  it('documents the error codes the API actually returns', () => {
    for (const code of ['400', '401', '403', '404', '429', '500']) {
      expect(specText).toContain(`| ${code}`);
    }
  });

  it('documents authentication and rate limiting', () => {
    expect(specText).toContain('Authorization: Bearer');
    expect(specText).toMatch(/1,000 requests\/minute/);
  });

  it('never declares a credential field as a schema property', () => {
    // Matches a YAML *key* (`pinHash:`), so prose that mentions the fields in
    // order to say they are withheld does not read as a leak.
    const offenders = specLines.filter((line) => /^\s+(pinHash|pinSalt):/.test(line));
    expect(offenders).toEqual([]);
  });
});
