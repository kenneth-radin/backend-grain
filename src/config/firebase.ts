import { env } from "./env";

/**
 * Firebase RTDB mirroring for the mobile app.
 *
 * Strategy: plain REST PATCH against the RTDB URL. The project security rules
 * allow reads/writes under /grain/**, so no service-account credentials are
 * required and this works on any host regardless of env vars.
 * Everything here is fire-and-forget: a mirror failure must never break the API.
 */

const DEFAULT_DB_URL =
  "https://grain-app-35c11-default-rtdb.asia-southeast1.firebasedatabase.app";

export function isFirebaseMirrorEnabled(): boolean {
  return Boolean(env.firebase.databaseUrl || DEFAULT_DB_URL);
}

function baseUrl(): string {
  let u = (env.firebase.databaseUrl || DEFAULT_DB_URL).trim();
  while (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

async function rtdbPatch(path: string, body: unknown): Promise<void> {
  const res = await fetch(baseUrl() + path + ".json", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("RTDB PATCH " + path + " -> " + res.status);
}

async function rtdbSet(path: string, body: unknown): Promise<void> {
  const res = await fetch(baseUrl() + path + ".json", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("RTDB SET " + path + " -> " + res.status);
}

/** Convert Mongo values (Date etc.) into RTDB-safe primitives. */
function toRtdb(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(toRtdb);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "_id" || k === "__v") continue;
      out[k] = toRtdb(v);
    }
    return out;
  }
  return value;
}

function warnOnce(msg: string, err: unknown): void {
  console.warn("[grAIn API] RTDB", msg, err instanceof Error ? err.message : err);
}

/**
 * Mirror the latest DHT22 reading under the exact path/shape the mobile app
 * useRealtimeSensor() listens to:
 *   grain/devices/{id}/sensors { temperature, humidity, status, updatedAt }
 *   grain/devices/{id}/status  = "online"
 */
export function mirrorDeviceReading(
  deviceId: string,
  temperature: number,
  humidity: number,
  status: string
): void {
  if (!isFirebaseMirrorEnabled()) return;
  const nowIso = new Date().toISOString();
  rtdbPatch("/grain/devices/" + deviceId, {
    status: "online",
    sensors: { temperature, humidity, status, updatedAt: nowIso },
    updatedAt: nowIso
  }).catch((err) => warnOnce("device mirror failed:", err));
}

/** Mirror the device Mongo runtimeState so the app sees live command state. */
export function mirrorRuntimeState(deviceId: string, runtimeState: unknown): void {
  if (!isFirebaseMirrorEnabled() || !runtimeState || typeof runtimeState !== "object") return;
  const clean = toRtdb(runtimeState) as Record<string, unknown>;
  delete clean._id;
  rtdbPatch("/grain/devices/" + deviceId + "/runtimeState", clean)
    .catch((err) => warnOnce("runtimeState mirror failed:", err));
}

/** Tell listening apps a queued command was executed (or failed) by hardware. */
export function mirrorCommandExecuted(deviceId: string, command: string, ok: boolean): void {
  if (!isFirebaseMirrorEnabled()) return;
  rtdbSet("/grain/commands/" + deviceId + "/executed", {
    command,
    ok,
    executedAt: Date.now()
  }).catch((err) => warnOnce("executed mirror failed:", err));
}
