import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `lib/railway-api.ts` exposes `api` as an untyped Proxy — `api.stadium.getX`
 * and `api.stadium.getXX` (a typo) both typecheck identically, and the typo
 * only surfaces as a thrown "Unknown Railway query route" at render time (see
 * useQuery/useMutation in railway-hooks.ts). This guard catches that class of
 * bug at test time instead of in a user's hands, by scanning every screen and
 * component for `api.<a>.<b>` references and asserting each one resolves to a
 * registered route.
 *
 * Deliberately one-directional: it does not flag routes with zero call sites.
 * Some registered routes are genuinely unused today — that is a cleanup
 * question (reconciling this route registry with the separate lib/api-client
 * layer), not a correctness bug, and is out of scope for this guard.
 *
 * Reads railway-hooks.ts as text rather than importing it: the module
 * transitively pulls in React Native (via offline-queue.ts), which Vitest's
 * Node environment cannot parse. Static parsing also matches this codebase's
 * existing drift-guard convention (see tenant-scope.spec.ts, roles.spec.ts).
 */
function extractRouteKeys(routesObjectName: 'queryRoutes' | 'mutationRoutes'): string[] {
  const source = readFileSync(join(__dirname, 'railway-hooks.ts'), 'utf8');
  const start = source.indexOf(`const ${routesObjectName}: Record<string, Route> = {`);
  if (start === -1) throw new Error(`Could not find ${routesObjectName} in railway-hooks.ts`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(braceStart, end);
  const keyPattern = /^\s*'([^']+)'\s*:/gm;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(body))) {
    keys.push(match[1]);
  }
  return keys;
}
function collectTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsxFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findApiReferences(root: string): Map<string, string[]> {
  const references = new Map<string, string[]>();
  for (const file of collectTsxFiles(join(__dirname, '..', root))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('railway-api')) continue; // only files that import `api`
    const pattern = /\bapi\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const key = `${match[1]}.${match[2]}`;
      const files = references.get(key) ?? [];
      files.push(file);
      references.set(key, files);
    }
  }
  return references;
}

describe('railway-hooks route registry drift guard', () => {
  it('every api.<namespace>.<action> reference in app/ and components/ resolves to a registered route', () => {
    const registered = new Set([...extractRouteKeys('queryRoutes'), ...extractRouteKeys('mutationRoutes')]);
    const referenced = new Map([...findApiReferences('app'), ...findApiReferences('components')]);

    expect(referenced.size).toBeGreaterThan(100); // sanity: the scan actually found references

    const missing = [...referenced.keys()].filter((key) => !registered.has(key));
    if (missing.length > 0) {
      const detail = missing
        .map((key) => `  ${key}\n    ${referenced.get(key)!.join('\n    ')}`)
        .join('\n');
      throw new Error(
        `The following api.* references have no matching route in railway-hooks.ts ` +
          `(queryRoutes/mutationRoutes). This is exactly the typo class this guard exists ` +
          `to catch — verify the route name, or register it if it's missing:\n${detail}`,
      );
    }
  });
});
