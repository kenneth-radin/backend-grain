/**
 * Equilibrium-moisture physics for rough rice (paddy) — DHT22-only predictive
 * analytics ground truth.
 *
 * The dryer has NO grain-moisture sensor, so "drying progress" is inferred
 * from the exhaust-air relative humidity: as the grain approaches its target
 * moisture, the air around it approaches the equilibrium relative humidity
 * (ERH) for that moisture at the current temperature.
 *
 * ERH is computed with the ASABE D245 Chung-Pfost equation:
 *
 *   ERH(T, M) = exp( -A / (T + C) * exp(-B * M) )
 *
 *   T : air temperature (°C)
 *   M : grain moisture content (decimal, wet basis, e.g. 0.14 for 14 %)
 *
 * Coefficients for ROUGH RICE from ASABE Standards (D245.x / D243.3) as cited
 * throughout the grain-drying literature:
 *   A = 289.727, B = 13.3862, C = 32.442
 *
 * NOTE: these are literature values. Cite ASABE D245 in the capstone paper and,
 * if experimental calibration data becomes available, re-fit the coefficients.
 */

const CHUNG_PFOST_ROUGH_RICE = { A: 289.727, B: 13.3862, C: 32.442 } as const;

/** Clamp range for moisture (decimal wb) kept inside the model's validity band. */
const M_MIN = 0.05;
const M_MAX = 0.40;

/**
 * Equilibrium relative humidity (% RH) of air in balance with rough rice at
 * `tempC` whose moisture content is `moistureDecimal` (wet basis).
 */
export function equilibriumRh(tempC: number, moistureDecimal: number): number {
  const { A, B, C } = CHUNG_PFOST_ROUGH_RICE;
  const m = Math.min(M_MAX, Math.max(M_MIN, moistureDecimal));
  const rh = Math.exp((-A / (tempC + C)) * Math.exp(-B * m)) * 100;
  return Math.min(100, Math.max(0, rh));
}

/**
 * Exhaust-RH threshold below which the grain is considered to have reached the
 * target moisture at temperature `tempC` (+1 pp tolerance so an equilibrium
 * plateau counts as completion).
 */
export function completionRhThreshold(tempC: number, targetMoisturePct: number): number {
  const rh = equilibriumRh(tempC, targetMoisturePct / 100) + 1;
  return Math.min(99, rh);
}

export interface EmcReading {
  temperature: number;
  humidity: number;
  timestamp: Date;
}

/**
 * True when every reading inside the trailing `sustainMinutes` window satisfies
 * humidity <= completionRhThreshold(temperature). Requires at least two samples
 * inside the window so a single lucky reading never triggers completion.
 */
export function hasSustainedCompletion(
  readings: EmcReading[],
  sustainMinutes: number,
  targetMoisturePct: number
): boolean {
  if (readings.length < 2) return false;
  const windowEnd = readings[readings.length - 1].timestamp.getTime();
  const cutoff = windowEnd - sustainMinutes * 60_000;

  let inWindow = 0;
  for (let i = readings.length - 1; i >= 0; i--) {
    const r = readings[i];
    if (r.timestamp.getTime() < cutoff) break;
    if (r.humidity > completionRhThreshold(r.temperature, targetMoisturePct)) return false;
    inWindow++;
  }
  return inWindow >= 2;
}