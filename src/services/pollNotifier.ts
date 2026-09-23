/**
 * pollNotifier.ts — in-process "long-poll" wakeup helper.
 *
 * A tiny single-instance event bus: when a command is enqueued it wakes any
 * ESP/HTTP request currently held open by GET /api/commands/:deviceId?longPoll=1
 * so command delivery collapses from a blind poll period down to ~instant.
 *
 * This is a BEST-EFFORT, PER-INSTANCE optimization (NOT a durable message bus):
 *  - It lives only in this process's memory. If the deployment runs multiple
 *    nodes, only the node that enqueued will fire.
 *  - Devices that don't use longPoll (e.g. the ESP8266 quick-polling every 3 s)
 *    are completely unaffected — they just read Mongo as usual.
 *  - If the process restarts, waiters are simply gone; pollers time out and
 *    re-query.
 */

type Waiter = (changed: boolean) => void;

const waiters = new Map<string, Waiter[]>();

/**
 * Wait up to `timeoutMs` for a new command to be created for `deviceId`.
 * Resolves `true` if notified (a command was enqueued) or `false` on timeout.
 */
export function waitForDeviceCommand(deviceId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let entry = waiters.get(deviceId);
    if (!entry) {
      entry = [];
      waiters.set(deviceId, entry);
    }
    let done = false;
    const finish = (changed: boolean): void => {
      if (done) return;
      done = true;
      const list = waiters.get(deviceId);
      if (list) {
        const idx = list.indexOf(finish);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) waiters.delete(deviceId);
      }
      resolve(changed);
    };
    entry.push(finish);
    setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Wake every open long-poll waiter for `deviceId` immediately.
 * Called right after a command is persisted so the awakened poller re-reads
 * Mongo and returns the fresh command in its response.
 */
export function notifyDevice(deviceId: string): void {
  const entry = waiters.get(deviceId);
  if (!entry || entry.length === 0) return;
  waiters.delete(deviceId);
  for (const fn of entry) fn(true);
}