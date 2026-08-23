import { NotificationItem } from '../models/NotificationItem';

type NotificationType =
  | 'drying_complete'
  | 'alert_critical'
  | 'alert_warning'
  | 'device_offline'
  | 'session_started'
  | 'session_aborted';

/**
 * Fire-and-forget in-app notification creation. Failures are logged but must
 * never break the calling request.
 */
export async function notifyUser(params: {
  userId: string | { toString(): string };
  type: NotificationType;
  title: string;
  body?: string;
  deviceId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await NotificationItem.create({
      userId: params.userId as never,
      deviceId: params.deviceId,
      type: params.type,
      title: params.title,
      body: params.body || '',
      data: params.data,
      isRead: false,
      sentViaFCM: false
    });
  } catch (err) {
    console.warn('[grAIn API] Failed to create notification:', err instanceof Error ? err.message : err);
  }
}

/** Create a device-wide alert with simple 30-minute dedup per title. */
export async function createAlert(params: {
  deviceId?: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  message?: string;
}): Promise<void> {
  try {
    const { AlertItem } = await import('../models/AlertItem');
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const existing = await AlertItem.findOne({
      deviceId: params.deviceId,
      title: params.title,
      timestamp: { $gte: since }
    }).lean();
    if (existing) return;

    await AlertItem.create({
      deviceId: params.deviceId,
      severity: params.severity,
      title: params.title,
      message: params.message || '',
      timestamp: new Date(),
      acknowledged: false
    });
  } catch (err) {
    console.warn('[grAIn API] Failed to create alert:', err instanceof Error ? err.message : err);
  }
}
