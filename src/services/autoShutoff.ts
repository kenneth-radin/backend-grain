import { DryingSession } from '../models/DryingSession';
import { Prediction } from '../models/Prediction';
import { User } from '../models/User';
import { parseCommandString } from './commandParser';
import { enqueueCommand } from './commandService';
import { finalizeSession } from './sessionStats';
import { notifyUser, createAlert } from './notificationService';
import { sendExpoPush } from './expoPush';

/**
 * Safety-critical auto-shutoff: server-authoritative, does NOT rely on the
 * mobile app. Fired on a schedule so an unattended heater stops even if the
 * app is killed.
 *
 * Finds every active session whose LATEST prediction's estimatedCompletionAt
 * has passed, sends the real STOP command (same enqueueCommand path as the
 * manual Stop button), then finalizes the session with completionSource='timer'.
 *
 * If the stop command can't be enqueued (e.g. device record missing), the
 * session is NOT silently completed — we log loudly and raise an in-app
 * notification + alert so the farmer sees "needs attention".
 *
 * ── SAFETY BOUNDARY ────────────────────────────────────────────────────────
 * This mechanism is SOFTWARE-ONLY. It depends entirely on this Node process
 * running its setInterval() loop in server.ts. It has NO independent
 * hardware-level backup: if the process crashes, the host dies, the interval
 * is not running, or Render sleeps/stops this instance, no STOP will be sent
 * until the process is running again and its next scheduled check (or the
 * boot-time check) fires. The physical heater must therefore have its own
 * hardware/firmware safety cutoff (e.g. a thermal fuse, thermostat, or
 * watchdog) — do not treat this software timer as the sole protection.
 * ───────────────────────────────────────────────────────────────────────────
 */
export async function runAutoShutoffCheck(): Promise<void> {
  try {
    const activeSessions = await DryingSession.find({ status: 'active' }).lean();

    for (const session of activeSessions) {
      const latest = await Prediction.findOne({ sessionId: session._id })
        .sort({ createdAt: -1 })
        .lean();

      if (!latest) continue; // no prediction yet — nothing to schedule against
      if (latest.estimatedCompletionAt.getTime() > Date.now()) continue; // not due

      const deviceId = session.deviceId;
      console.log(
        `[grAIn API] Auto-shutoff: session ${session._id} (device ${deviceId}) completed at estimate — issuing STOP`
      );

      // Reuse the exact manual-stop code path (dryerController.stopDryer ->
      // buildAndEnqueue -> enqueueCommand). We call enqueueCommand directly to
      // avoid HTTP boilerplate, with the STOP command re-parsed for consistency.
      const parsed = parseCommandString('STOP');
      if (!parsed) {
        throw new Error('STOP command failed to parse — cannot auto-shutoff');
      }

      let stopped = false;
      try {
        await enqueueCommand(deviceId, parsed);
        stopped = true;
      } catch (err) {
        console.error(
          `[grAIn API] Auto-shutoff FAILED for ${deviceId}: stop command could not be enqueued`,
          err instanceof Error ? err.message : err
        );
      }

      if (stopped) {
        // Finalize with completionSource='timer' (reuses finalizeSession which
        // clears runtimeState.isRunning and recomputes stats).
        const fresh = await DryingSession.findById(session._id);
        if (fresh && fresh.status === 'active') {
          await finalizeSession(fresh, 'completed', 'timer');
          void notifyUser({
            userId: fresh.userId as never,
            deviceId,
            type: 'drying_complete',
            title: 'Drying complete (auto)',
            body: `Auto-shutoff stopped ${deviceId} at the predicted completion time.`,
          });
        }
      } else {
        // Do NOT mark complete. Surface "needs attention" to the owner.
        await createAlert({
          deviceId,
          severity: 'warning',
          title: 'Auto-shutoff failed',
          message: `Auto-stop for ${deviceId} could not be sent. Device may still be running.`,
        });
        void notifyUser({
          userId: session.userId as never,
          deviceId,
          type: 'alert_warning',
          title: 'Auto-shutoff failed',
          body: `Auto-stop for ${deviceId} could not be sent. Device may still be running.`,
        });

        // Real push: look up the owner's Expo push token and send, so an
        // offline device that misses auto-stop is surfaced even if the app is
        // closed. Missing/absent token is skipped silently (in-app alert above
        // still covers it).
        const owner = await User.findById(session.userId).select('pushToken').lean();
        void sendExpoPush(
          owner?.pushToken ?? null,
          'Auto-shutoff failed',
          `Auto-stop for ${deviceId} could not be sent. Device may still be running.`
        );
      }
    }
  } catch (err) {
    console.error(
      '[grAIn API] Auto-shutoff check failed:',
      err instanceof Error ? err.stack : err
    );
  }
}