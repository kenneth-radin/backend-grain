import { DryingSession, IDryingSessionDoc } from '../models/DryingSession';
import { SensorDatum } from '../models/SensorDatum';
import { Prediction, IPredictionDoc } from '../models/Prediction';
import { env } from '../config/env';
import { clamp, round1 } from '../utils/http';
import {
  EmcReading,
  completionRhThreshold,
  hasSustainedCompletion
} from './emc';

/**
 * Drying-progress prediction pipeline (DHT22-only predictive analytics).
 *
 * Flow: active session -> feature vector from SensorDatum history -> trained ML
 * model (Python microservice, env.mlServiceUrl) -> fallback exponential-decay
 * physics estimator when the model is unavailable/untrained -> status +
 * recommendation mapping -> persisted Prediction row.
 *
 * The prediction answers: "roughly how much longer should this batch dry, and
 * at what time will it reach the target end condition?"
 */

export type PredictionStatus = 'in_progress' | 'approaching_completion' | 'estimated_complete';

export type PredictionRecommendation =
  | 'CONTINUE_DRYING'
  | 'REDUCE_HEATING'
  | 'INCREASE_AIRFLOW'
  | 'APPROACHING_COMPLETION'
  | 'ESTIMATED_COMPLETE';

/** Feature contract shared with ml/service.py — keep in sync. */
export interface PredictionFeatures {
  elapsedMinutes: number;
  temperature: number;
  humidity: number;
  rhGapToEquilibrium: number;
  humidityRate15: number;
  humidityRate30: number;
  temperatureRate30: number;
}

interface ReadingPoint extends EmcReading {}

const FEATURE_WINDOW_MIN = 30; // slope windows (minutes)
const PHYSICS_FIT_WINDOW_MIN = 180; // history used by the decay fit

function toPoints(
  readings: Array<{ temperature: number; humidity: number; timestamp: Date }>
): ReadingPoint[] {
  return readings.map((r) => ({
    temperature: Number(r.temperature),
    humidity: Number(r.humidity),
    timestamp: new Date(r.timestamp)
  }));
}

/** Least-squares slope of `pick(point)` per minute over a trailing window. */
function slopePerMinute(
  points: ReadingPoint[],
  windowMinutes: number,
  pick: (p: ReadingPoint) => number
): number {
  if (points.length < 2) return 0;
  const end = points[points.length - 1].timestamp.getTime();
  const cutoff = end - windowMinutes * 60_000;
  const window = points.filter((p) => p.timestamp.getTime() >= cutoff);
  if (window.length < 2) return 0;

  const x0 = window[0].timestamp.getTime();
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of window) {
    const x = (p.timestamp.getTime() - x0) / 60_000; // minutes
    const y = pick(p);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = window.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sxy - sx * sy) / denom;
}

async function buildFeatures(
  session: IDryingSessionDoc
): Promise<{ features: PredictionFeatures; readings: ReadingPoint[] } | null> {
  const docs = await SensorDatum.find({
    deviceId: session.deviceId,
    timestamp: { $gte: new Date(session.startedAt) }
  })
    .sort({ timestamp: 1 })
    .select('temperature humidity timestamp')
    .lean();

  if (docs.length < 3) return null; // not enough signal yet
  const readings = toPoints(docs);
  const last = readings[readings.length - 1];

  const elapsedMinutes =
    (last.timestamp.getTime() - new Date(session.startedAt).getTime()) / 60_000;
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) return null;

  // Average equilibrium threshold over the recent window (temperature varies).
  const recent = readings.filter(
    (p) => p.timestamp.getTime() >= last.timestamp.getTime() - 15 * 60_000
  );
  const avgTempRecent =
    recent.reduce((s, p) => s + p.temperature, 0) / Math.max(1, recent.length);
  const eqThreshold = completionRhThreshold(avgTempRecent, env.targetMoisturePct);

  return {
    readings,
    features: {
      elapsedMinutes: round1(elapsedMinutes),
      temperature: round1(last.temperature),
      humidity: round1(last.humidity),
      rhGapToEquilibrium: round1(last.humidity - eqThreshold),
      humidityRate15: round1(slopePerMinute(readings, 15, (p) => p.humidity)),
      humidityRate30: round1(slopePerMinute(readings, FEATURE_WINDOW_MIN, (p) => p.humidity)),
      temperatureRate30: round1(slopePerMinute(readings, FEATURE_WINDOW_MIN, (p) => p.temperature))
    }
  };
}

/**
 * Physics fallback: fit an exponential decay ln(gap(t)) = a + b*t to the
 * trailing exhaust-RH gap and extrapolate when the gap reaches the floor.
 * Used only while no trained model is served (or the model service is down),
 * so the system still produces genuine predictions instead of static rules.
 */
function estimateRemainingPhysicsFallback(readings: ReadingPoint[]): number | null {
  const end = readings[readings.length - 1].timestamp.getTime();
  const cutoff = end - PHYSICS_FIT_WINDOW_MIN * 60_000;
  const pts = readings.filter((p) => p.timestamp.getTime() >= cutoff);
  if (pts.length < 4) return null;

  const t0 = pts[0].timestamp.getTime();
  const GAP_FLOOR = 0.5; // log-safe clamp (pp); completion ≈ gap reaching floor
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let n = 0;
  for (const p of pts) {
    const threshold = completionRhThreshold(p.temperature, env.targetMoisturePct);
    const gap = Math.max(GAP_FLOOR, p.humidity - threshold);
    const x = (p.timestamp.getTime() - t0) / 60_000;
    const y = Math.log(gap);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    n++;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;

  const b = (n * sxy - sx * sy) / denom; // per minute (expected negative)
  const a = (sy - b * sx) / n;
  if (b >= -1e-6) return null; // gap not decaying — cannot extrapolate

  // Minutes FROM NOW until ln(gap) reaches ln(GAP_FLOOR). The fit's x-axis
  // starts at the window beginning, so subtract the elapsed window span.
  const nowOffsetMin = (end - t0) / 60_000;
  const remaining = (Math.log(GAP_FLOOR) - a) / b - nowOffsetMin;
  if (!Number.isFinite(remaining)) return null;
  return clamp(remaining, 0, 12 * 60);
}

/** Calls the Python model service; returns remaining minutes or null. */
async function predictWithModel(features: PredictionFeatures): Promise<number | null> {
  if (!env.mlServiceUrl) return null;
  try {
    const res = await fetch(`${env.mlServiceUrl.replace(/\/+$/, '')}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(3_000)
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { remainingMinutes?: unknown };
    const value = Number(body.remainingMinutes);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function classify(
  remainingMinutes: number,
  plateauComplete: boolean,
  temperature: number,
  humidity: number
): { status: PredictionStatus; recommendation: PredictionRecommendation } {
  if (plateauComplete || remainingMinutes <= 0.5) {
    return { status: 'estimated_complete', recommendation: 'ESTIMATED_COMPLETE' };
  }
  if (remainingMinutes <= 45) {
    return { status: 'approaching_completion', recommendation: 'APPROACHING_COMPLETION' };
  }
  // Advisory control guidance derived from the predicted state.
  if (temperature > 60) return { status: 'in_progress', recommendation: 'REDUCE_HEATING' };
  if (humidity >= 80) return { status: 'in_progress', recommendation: 'INCREASE_AIRFLOW' };
  return { status: 'in_progress', recommendation: 'CONTINUE_DRYING' };
}

/** Runs the full pipeline for one session and persists a Prediction row. */
export async function predictAndStore(session: IDryingSessionDoc): Promise<IPredictionDoc | null> {
  const built = await buildFeatures(session);
  if (!built) return null;
  const { features, readings } = built;

  const plateauComplete = hasSustainedCompletion(
    readings,
    env.completionSustainMinutes,
    env.targetMoisturePct
  );

  const modelRemaining = await predictWithModel(features);
  let remainingMinutes: number;
  let source: 'ml_model' | 'physics_fallback';
  if (modelRemaining !== null) {
    remainingMinutes = clamp(modelRemaining, 0, 24 * 60);
    source = 'ml_model';
  } else {
    const fallback = estimateRemainingPhysicsFallback(readings);
    if (fallback === null) return null; // genuinely not enough signal yet
    remainingMinutes = fallback;
    source = 'physics_fallback';
  }

  const { status, recommendation } = classify(
    remainingMinutes,
    plateauComplete,
    features.temperature,
    features.humidity
  );

  return Prediction.create({
    sessionId: session._id,
    deviceId: session.deviceId,
    elapsedMinutes: features.elapsedMinutes,
    temperature: features.temperature,
    humidity: features.humidity,
    rhGapToEquilibrium: features.rhGapToEquilibrium,
    remainingMinutes: Math.round(remainingMinutes),
    estimatedCompletionAt: new Date(Date.now() + remainingMinutes * 60_000),
    status,
    recommendation,
    source,
    modelVersion: source === 'ml_model' ? env.mlModelVersion : 'untrained'
  });
}

/**
 * Fire-and-forget entry point used by the sensor ingress: refreshes the latest
 * prediction for a device's active session, throttled so 10-second ESP posts do
 * not spam predictions (see PREDICTION_MIN_INTERVAL_MS).
 */
export async function refreshLatestForDevice(deviceId: string): Promise<void> {
  try {
    const session = await DryingSession.findOne({ deviceId, status: 'active' }).sort({
      startedAt: -1
    });
    if (!session) return;

    const latest = await Prediction.findOne({ sessionId: session._id })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    if (
      latest &&
      Date.now() - new Date(latest.createdAt).getTime() < env.predictionMinIntervalMs
    ) {
      return; // throttled
    }

    await predictAndStore(session);
  } catch (err) {
    console.warn(
      '[grAIn API] Prediction refresh failed:',
      err instanceof Error ? err.message : err
    );
  }
}
