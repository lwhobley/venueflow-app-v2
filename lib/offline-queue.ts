import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { apiRequest, ApiError } from './api-client';
import { useAuthStore } from './auth-store';
import { createOperationId } from './idempotency';

export type OfflineMutationStatus = 'queued' | 'retrying' | 'conflict' | 'blocked_scope' | 'failed';

export type OfflineMutation = {
  id: string;
  scopeKey: string;
  userId: string;
  venueId: string;
  path: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** A serial stream for one operational resource, such as an outlet readiness row. */
  entityKey: string;
  /** Stable across first attempt, retry, restart, and reconnect. */
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: OfflineMutationStatus;
  lastError?: string;
};

export type OfflineQueueSnapshot = {
  pending: number;
  conflicts: number;
};

type EnqueueInput = Omit<OfflineMutation, 'id' | 'scopeKey' | 'userId' | 'venueId' | 'createdAt' | 'attempts' | 'nextAttemptAt' | 'status'>;

const DB_NAME = 'venue-wrangler-offline-operations.db';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const listeners = new Set<(snapshot: OfflineQueueSnapshot) => void>();
let queue: OfflineMutation[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let flushPromise: Promise<number> | null = null;
let nativeDb: Promise<SQLite.SQLiteDatabase> | null = null;

export class OfflineQueueStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OfflineQueueStorageError';
    this.cause = cause;
  }
}

function scope() {
  const state = useAuthStore.getState();
  const userId = state.user?.id;
  const venueId = state.venue?.id;
  if (!userId || !venueId) throw new OfflineQueueStorageError('Sign in to an assigned venue before queueing event operations.');
  return { userId, venueId, scopeKey: `${userId}:${venueId}` };
}

function ownedRows() {
  const state = useAuthStore.getState();
  return queue.filter((item) => item.userId === state.user?.id && item.venueId === state.venue?.id);
}

function snapshot(): OfflineQueueSnapshot {
  return {
    pending: ownedRows().filter((item) => item.status === 'queued' || item.status === 'retrying').length,
    conflicts: ownedRows().filter((item) => item.status === 'conflict' || item.status === 'blocked_scope' || item.status === 'failed').length,
  };
}

function notify() {
  const next = snapshot();
  listeners.forEach((listener) => listener(next));
}

function isTestRuntime() {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
}

async function database() {
  if (nativeDb) return nativeDb;
  nativeDb = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS offline_mutations (
        id TEXT PRIMARY KEY NOT NULL,
        scope_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        venue_id TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS offline_mutations_scope_order
        ON offline_mutations(scope_key, entity_key, created_at);
    `);
    return db;
  })().catch((error) => {
    nativeDb = null;
    throw new OfflineQueueStorageError('Offline operation storage is unavailable on this device.', error);
  });
  return nativeDb;
}

function openWebDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    if (isTestRuntime()) return Promise.reject(new OfflineQueueStorageError('test-memory'));
    return Promise.reject(new OfflineQueueStorageError('IndexedDB is unavailable; offline operations cannot be safely queued in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new OfflineQueueStorageError('Could not open the browser offline-operation store.', request.error));
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains('scope_order')) store.createIndex('scope_order', ['scopeKey', 'entityKey', 'createdAt']);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function loadRows(): Promise<OfflineMutation[]> {
  if (Platform.OS !== 'web') {
    const db = await database();
    const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM offline_mutations ORDER BY created_at ASC');
    return rows.map((row) => JSON.parse(row.payload) as OfflineMutation);
  }
  try {
    const db = await openWebDatabase();
    return await new Promise<OfflineMutation[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(new OfflineQueueStorageError('Could not read browser offline operations.', request.error));
      request.onsuccess = () => resolve(request.result as OfflineMutation[]);
    });
  } catch (error) {
    if (isTestRuntime() && error instanceof OfflineQueueStorageError && error.message === 'test-memory') return queue;
    throw error;
  }
}

async function writeRow(row: OfflineMutation) {
  if (Platform.OS !== 'web') {
    const db = await database();
    await db.runAsync(
      `INSERT INTO offline_mutations (id, scope_key, user_id, venue_id, entity_key, status, next_attempt_at, created_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, next_attempt_at = excluded.next_attempt_at, payload = excluded.payload`,
      row.id, row.scopeKey, row.userId, row.venueId, row.entityKey, row.status, row.nextAttemptAt, row.createdAt, JSON.stringify(row),
    );
    return;
  }
  try {
    const db = await openWebDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(row);
      request.onerror = () => reject(new OfflineQueueStorageError('Could not persist browser offline operation.', request.error));
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    if (isTestRuntime() && error instanceof OfflineQueueStorageError && error.message === 'test-memory') return;
    throw error;
  }
}

async function deleteRow(id: string) {
  if (Platform.OS !== 'web') {
    const db = await database();
    await db.runAsync('DELETE FROM offline_mutations WHERE id = ?', id);
    return;
  }
  try {
    const db = await openWebDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
      request.onerror = () => reject(new OfflineQueueStorageError('Could not remove synchronized browser operation.', request.error));
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    if (isTestRuntime() && error instanceof OfflineQueueStorageError && error.message === 'test-memory') return;
    throw error;
  }
}

async function ensureLoaded() {
  if (loaded) return;
  if (!loading) {
    loading = loadRows().then((rows) => {
      queue = rows;
      loaded = true;
      notify();
    }).finally(() => { loading = null; });
  }
  await loading;
}

function retryAt(attempts: number) {
  const capped = Math.min(attempts, 8);
  const base = Math.min(5 * 60_000, 1_000 * (2 ** capped));
  return Date.now() + base + Math.floor(Math.random() * 500);
}

function replace(row: OfflineMutation) {
  queue = queue.map((item) => item.id === row.id ? row : item);
  notify();
}

export function subscribeOfflineQueue(listener: (snapshot: OfflineQueueSnapshot) => void) {
  listeners.add(listener);
  void ensureLoaded().catch(() => listener({ pending: 0, conflicts: 0 }));
  return () => listeners.delete(listener);
}

export function offlineQueueSize() {
  return snapshot().pending;
}

export function offlineQueueConflictCount() {
  return snapshot().conflicts;
}

export function offlineQueueConflicts() {
  return ownedRows().filter((item) => item.status === 'conflict' || item.status === 'blocked_scope' || item.status === 'failed');
}

function sanitizeOfflinePayload(body: any): any {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(sanitizeOfflinePayload);
  const sanitized: Record<string, any> = { ...body };
  delete sanitized.pin;
  delete sanitized.badgeCode;
  delete sanitized.password;
  return sanitized;
}

export async function enqueueOfflineMutation(input: EnqueueInput) {
  await ensureLoaded();
  const owner = scope();
  const idempotencyKey = (input.idempotencyKey && input.idempotencyKey.trim().length >= 16)
    ? input.idempotencyKey.trim()
    : await createOperationId();
  const sanitizedBody = sanitizeOfflinePayload(input.body ?? undefined);
  const row: OfflineMutation = {
    ...input,
    id: await createOperationId(),
    ...owner,
    idempotencyKey,
    body: sanitizedBody,
    headers: { ...(input.headers ?? {}), 'Idempotency-Key': idempotencyKey },
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    status: 'queued',
  };
  await writeRow(row);

  queue = [...queue, row];
  notify();
  return { queued: true as const, queueSize: offlineQueueSize(), idempotencyKey: row.idempotencyKey };
}

/** Re-queue a conflicted/failed mutation for another attempt. Keeps the same idempotency key. */
export async function retryOfflineMutation(id: string) {
  await ensureLoaded();
  const row = ownedRows().find((item) => item.id === id);
  if (!row) return false;
  if (row.status !== 'conflict' && row.status !== 'blocked_scope' && row.status !== 'failed' && row.status !== 'retrying') {
    return false;
  }
  const next: OfflineMutation = {
    ...row,
    status: 'queued',
    nextAttemptAt: Date.now(),
    lastError: undefined,
  };
  await writeRow(next);
  replace(next);
  return true;
}

/** Permanently discard a conflicted mutation after the operator resolves it outside the app. */
export async function dismissOfflineMutation(id: string) {
  await ensureLoaded();
  const row = ownedRows().find((item) => item.id === id);
  if (!row) return false;
  if (row.status !== 'conflict' && row.status !== 'blocked_scope' && row.status !== 'failed') {
    return false;
  }
  await deleteRow(id);
  queue = queue.filter((item) => item.id !== id);
  notify();
  return true;
}

async function flush() {
  await ensureLoaded();
  const owner = scope();
  const blockedEntities = new Set<string>();
  const rows = [...queue].sort((a, b) => a.createdAt - b.createdAt);

  for (const row of rows) {
    if (row.userId !== owner.userId) {
      continue;
    }
    if (row.venueId !== owner.venueId) continue;
    if (row.status === 'conflict' || row.status === 'blocked_scope' || row.status === 'failed' || row.nextAttemptAt > Date.now()) {
      blockedEntities.add(row.entityKey);
      continue;
    }
    if (blockedEntities.has(row.entityKey)) continue;

    const current = useAuthStore.getState();
    if (!current.user?.id || !current.venue?.id || current.user.id !== owner.userId || current.venue.id !== owner.venueId) break;

    try {
      await apiRequest(row.path, {
        method: row.method,
        body: row.body,
        headers: row.headers,
        timeoutMs: 10_000,
      });
      await deleteRow(row.id);
      queue = queue.filter((item) => item.id !== row.id);
      notify();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const status: OfflineMutationStatus = apiError?.status === 409
        ? 'conflict'
        : apiError?.status === 401 || apiError?.status === 403
          ? 'blocked_scope'
          : apiError && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 408 && apiError.status !== 429
            ? 'failed'
            : 'retrying';
      const next: OfflineMutation = {
        ...row,
        attempts: row.attempts + 1,
        status,
        nextAttemptAt: status === 'retrying' ? retryAt(row.attempts + 1) : Number.MAX_SAFE_INTEGER,
        lastError: error instanceof Error ? error.message : 'Offline operation failed.',
      };
      await writeRow(next);
      replace(next);
      blockedEntities.add(row.entityKey);
    }
  }
  return offlineQueueSize();
}

/** Single-flight replay prevents duplicate sends during foreground/network events. */
export function flushOfflineQueue() {
  if (!flushPromise) {
    flushPromise = flush().finally(() => { flushPromise = null; });
  }
  return flushPromise;
}

