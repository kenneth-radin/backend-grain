import { env } from './env';

/**
 * OPTIONAL Firebase Realtime Database mirroring (never the primary store).
 *
 * Enabled ONLY when FIREBASE_DATABASE_URL is set AND `firebase-admin` is
 * installed (`npm install firebase-admin`). Everything here is fire-and-forget:
 * a mirror failure must never break the REST API.
 */

let initialized = false;

/* eslint-disable @typescript-eslint/no-var-requires */
function lazyRequire(moduleName: string): any {
  // eval('require') keeps the bundler/TS compiler from resolving the optional
  // dependency at build time; it is resolved lazily at runtime instead.
  const nodeRequire: (name: string) => any = eval('require');
  return nodeRequire(moduleName);
}

export function isFirebaseMirrorEnabled(): boolean {
  return env.firebase.enabled;
}

/**
 * firebase-admin >= 13 flattened the old `admin.credential.cert()` factory
 * into a root-level `cert()`. Support both so either major version works.
 */
function certFor(admin: any): any {
  const factory = admin.credential?.cert ?? admin.cert;
  if (typeof factory !== 'function') {
    throw new Error('No cert() factory found in firebase-admin');
  }
  return factory({
    projectId: env.firebase.projectId,
    clientEmail: env.firebase.clientEmail,
    privateKey: env.firebase.privateKey
  });
}

/**
 * firebase-admin >= 13 moved `admin.database()` into the
 * `firebase-admin/database` subpath module. Support both shapes.
 */
function getDbFor(admin: any): any {
  if (typeof admin.database === 'function') {
    return admin.database();
  }
  const mod = lazyRequire('firebase-admin/database');
  const getDatabase = mod.getDatabase ?? mod.default?.getDatabase;
  if (typeof getDatabase !== 'function') {
    throw new Error('No getDatabase() found in firebase-admin');
  }
  return getDatabase();
}

function ensureInit(): any {
  if (initialized) {
    const admin = lazyRequire('firebase-admin');
    return admin;
  }
  const admin = lazyRequire('firebase-admin');
  admin.initializeApp({
    credential: certFor(admin),
    databaseURL: env.firebase.databaseUrl
  });
  initialized = true;
  console.log('[grAIn API] Firebase RTDB mirror initialized');
  return admin;
}

/** Convert Mongo values (Date etc.) into RTDB-safe primitives. */
function toRtdb(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(toRtdb);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_id' || k === '__v') continue;
      out[k] = toRtdb(v);
    }
    return out;
  }
  return value;
}

/**
 * Mirror the latest DHT22 reading to RTDB under the path/shape the mobile app
 * listens to: grain/devices/{id}/sensors + status:'online'.
 */
export function mirrorDeviceReading(
  deviceId: string,
  temperature: number,
  humidity: number,
  status: string
): void {
  if (!isFirebaseMirrorEnabled()) return;
  try {
    const admin = ensureInit();
    const db = getDbFor(admin);
    const nowIso = new Date().toISOString();
    void db
      .ref(`grain/devices/${deviceId}`)
      .update({
        status: 'online',
        sensors: { temperature, humidity, status, updatedAt: nowIso },
        updatedAt: nowIso
      })
      .catch((err: unknown) => {
        console.warn('[grAIn API] RTDB mirror failed:', err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.warn(
      '[grAIn API] RTDB mirror unavailable:',
      err instanceof Error ? err.message : err
    );
  }
}

/** Mirror the device's Mongo runtimeState so the app sees live command state. */
export function mirrorRuntimeState(deviceId: string, runtimeState: unknown): void {
  if (!isFirebaseMirrorEnabled() || !runtimeState || typeof runtimeState !== 'object') return;
  try {
    const admin = ensureInit();
    const db = getDbFor(admin);
    const clean = toRtdb(runtimeState);
    void db
      .ref(`grain/devices/${deviceId}/runtimeState`)
      .update(clean as Record<string, unknown>)
      .catch((err: unknown) => {
        console.warn('[grAIn API] RTDB runtimeState mirror failed:', err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.warn('[grAIn API] RTDB runtimeState mirror unavailable:', err instanceof Error ? err.message : err);
  }
}

/** Tell listening apps a queued command was executed (or failed) by hardware. */
export function mirrorCommandExecuted(deviceId: string, command: string, ok: boolean): void {
  if (!isFirebaseMirrorEnabled()) return;
  try {
    const admin = ensureInit();
    const db = getDbFor(admin);
    void db
      .ref(`grain/commands/${deviceId}/executed`)
      .set({ command, ok, executedAt: Date.now() })
      .catch((err: unknown) => {
        console.warn('[grAIn API] RTDB executed mirror failed:', err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.warn('[grAIn API] RTDB executed mirror unavailable:', err instanceof Error ? err.message : err);
  }
}
