/** Deterministic pseudo-random so re-seeds look similar. */
let seedState = 42;
export function rand(): number {
  seedState = (seedState * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seedState / 2_147_483_648;
}

export const MIN = 60_000;
export const HOUR = 3_600_000;

/**
 * Simulated drying day: ambient ~26-32 °C with midday peak; when the dryer is
 * running the temp ramps to the ~44-52 band and RH drops accordingly (DHT22).
 */
export function simulateReadings(
  hours: number,
  stepMin: number
): Array<{ temperature: number; humidity: number; timestamp: Date }> {
  const out: Array<{ temperature: number; humidity: number; timestamp: Date }> = [];
  const now = new Date();
  const start = new Date(now.getTime() - hours * HOUR);
  // Dryer runs from hour 8 to hour 20 of the window (daytime).
  const runStart = start.getTime() + 8 * HOUR;
  const runEnd = start.getTime() + 20 * HOUR;

  let t = 30;
  let h = 70;
  for (let ts = start.getTime(); ts <= now.getTime(); ts += stepMin * MIN) {
    const hourOfDay = new Date(ts).getHours();
    const diurnal = Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI); // peaks ~noon
    const running = ts >= runStart && ts <= runEnd;

    if (running) {
      const ramp = Math.min(1, (ts - runStart) / (90 * MIN)); // 90 min heat-up
      const targetT = 46 + diurnal * 4 + rand() * 2;
      const targetH = 52 - diurnal * 6 + rand() * 3;
      t += (targetT * ramp + 30 * (1 - ramp) - t) * 0.35;
      h += ((targetH * ramp + 72 * (1 - ramp)) - h) * 0.35;
    } else {
      const targetT = 27 + diurnal * 4 + rand() * 1.5;
      const targetH = 74 - diurnal * 10 + rand() * 4;
      t += (targetT - t) * 0.25;
      h += (targetH - h) * 0.25;
    }

    out.push({ timestamp: new Date(ts), temperature: Math.round(t * 10) / 10, humidity: Math.round(h) });
  }
  return out;
}
