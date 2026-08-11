import { readFileSync } from 'node:fs';

function localDatabaseValue(key) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^"|"$/g, '');
  } catch {
    return undefined;
  }
}

const databaseUrl = process.env.DATABASE_URL ?? localDatabaseValue('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database commands.');
}

const expectedProjectRef = (process.env.EXPECTED_SUPABASE_PROJECT_REF ?? localDatabaseValue('EXPECTED_SUPABASE_PROJECT_REF'))?.trim().toLowerCase();

for (const [key, value] of [
  ['DATABASE_URL', databaseUrl],
  ['DATABASE_DIRECT_URL', process.env.DATABASE_DIRECT_URL ?? localDatabaseValue('DATABASE_DIRECT_URL')],
]) {
  if (!value) continue;
  const hostname = new URL(value).hostname.toLowerCase();
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isSupabase = hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.com');

  if (!isLocal && !isSupabase) {
    throw new Error(`Refusing database command: ${key} targets ${hostname}; expected Supabase or local Postgres.`);
  }

  if (!isLocal && expectedProjectRef) {
    const username = decodeURIComponent(new URL(value).username).toLowerCase();
    const targetsExpectedProject = hostname.includes(`.${expectedProjectRef}.`) || username === `postgres.${expectedProjectRef}`;
    if (!targetsExpectedProject) {
      throw new Error(`Refusing database command: ${key} does not target the expected Supabase project ${expectedProjectRef}.`);
    }
  }
}
