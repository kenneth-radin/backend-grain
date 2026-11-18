import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

/**
 * Thin wrapper around expo-server-sdk so the actual send is isolated in one
 * place and can be swapped/mocked in tests. Sends to Expo push tokens of the
 * form `ExponentPushToken[...]` that the mobile app stores in User.pushToken.
 */

// Lazily-created singleton. Kept mutable so tests can inject a fake `send`.
let expo: { send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]> } | null = null;

function getExpo(): { send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]> } {
  if (!expo) {
    const client = new Expo();
    expo = {
      // expo-server-sdk: sendPushNotificationsAsync accepts arrays up to 100 msgs.
      send: (messages) => client.sendPushNotificationsAsync(messages),
    };
  }
  return expo;
}

/** For tests only — replace the internal sender. */
export function __setExpoTransportForTests(
  fake: { send: (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]> } | null
): void {
  expo = fake;
}

/**
 * Send one push notification to a single Expo push token. Returns true if a
 * send was attempted (token exists and looks like an Expo token); false if the
 * token was absent/unusable so the caller can decide what to do.
 */
export async function sendExpoPush(
  pushToken: string | null | undefined,
  title: string,
  body: string
): Promise<boolean> {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken[')) {
    return false; // no usable token — caller should skip silently
  }

  try {
    const result = await getExpo().send([
      {
        to: pushToken,
        sound: 'default',
        title,
        body,
      },
    ]);
    // Tally tickets (best-effort; caller does not depend on the outcome).
    for (const ticket of result) {
      if (ticket?.status === 'error') {
        console.warn('[grAIn API] Expo push rejected:', (ticket as { message?: string }).message);
      }
    }
    return true;
  } catch (err) {
    console.warn(
      '[grAIn API] Expo push send failed:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}