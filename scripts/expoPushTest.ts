/**
 * Test for Expo push sending used by the auto-shutoff failure path.
 *
 * Mocks the expo-server-sdk transport so no real network call is made.
 * Verifies:
 *   1. sendExpoPush() calls the transport with the correct token + message.
 *   2. sendExpoPush() is skipped cleanly when pushToken is null/absent.
 */
import { __setExpoTransportForTests, sendExpoPush } from '../src/services/expoPush';

async function main() {
  let failures = 0;
  const calls: unknown[][] = [];

  // Inject a fake transport that records everything.
  __setExpoTransportForTests({
    send: async (messages: unknown[]) => {
      calls.push(messages);
      return [];
    },
  });

  // Case 1: valid Expo token → transport called with correct payload.
  const sent = await sendExpoPush(
    'ExponentPushToken[abc123]',
    'Auto-shutoff failed',
    'Auto-stop for GR-SIM could not be sent.'
  );
  if (sent === true && calls.length === 1) {
    console.log('  PASS  valid token -> send attempted (returned true)');
  } else {
    failures++;
    console.log(`  FAIL  valid token -> expected true + 1 call, got ${sent}/${calls.length}`);
  }
  const msg = calls[0]?.[0] as any;
  if (msg?.to === 'ExponentPushToken[abc123]' && msg?.title === 'Auto-shutoff failed' && msg?.body === 'Auto-stop for GR-SIM could not be sent.') {
    console.log('  PASS  transport received correct token + title + body');
  } else {
    failures++;
    console.log(`  FAIL  transport payload wrong: ${JSON.stringify(msg)}`);
  }

  // Case 2: null/absent token → skipped, no additional transport call.
  const before = calls.length;
  const skipped = await sendExpoPush(null, 'X', 'Y');
  const skipped2 = await sendExpoPush(undefined, 'X', 'Y');
  const skipped3 = await sendExpoPush('not-an-expo-token', 'X', 'Y');
  if (skipped === false && skipped2 === false && skipped3 === false && calls.length === before) {
    console.log('  PASS  missing/invalid token -> skipped (no transport call)');
  } else {
    failures++;
    console.log(`  FAIL  missing/invalid token -> expected false + no extra call, got ${skipped}/${skipped2}/${skipped3} calls=${calls.length}`);
  }

  console.log(failures === 0 ? '\nEXPO PUSH TEST: ALL PASSED ✅' : `\nEXPO PUSH TEST: ${failures} FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('[expo-push-test]', e); process.exit(1); });