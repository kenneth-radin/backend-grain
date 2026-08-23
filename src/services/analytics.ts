import { SensorDatum } from '../models/SensorDatum';
import { DryingSession } from '../models/DryingSession';
import { round1 } from '../utils/http';

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

interface Bucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

interface TrendPoint {
  label: string;
  value: number;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildBuckets(period: AnalyticsPeriod): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];

  if (period === 'daily') {
    // Last 7 days, one bucket per day.
    for (let i = 6; i >= 0; i--) {
      const start = startOfUtcDay(new Date(now.getTime() - i * 86_400_000));
      const end = new Date(start.getTime() + 86_400_000);
      buckets.push({ key: dayKey(start), label: WEEKDAYS[start.getUTCDay()], start, end });
    }
    return buckets;
  }

  if (period === 'weekly') {
    // Last 6 weeks, buckets aligned to Monday (UTC).
    const today = startOfUtcDay(now);
    const dow = (today.getUTCDay() + 6) % 7; // Mon=0
    const thisMonday = new Date(today.getTime() - dow * 86_400_000);
    for (let i = 5; i >= 0; i--) {
      const start = new Date(thisMonday.getTime() - i * 7 * 86_400_000);
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const label = `${pad2(start.getUTCMonth() + 1)}/${pad2(start.getUTCDate())}`;
      buckets.push({ key: `w-${dayKey(start)}`, label, start, end });
    }
    return buckets;
  }

  // monthly — last 12 months.
  for (let i = 11; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    buckets.push({
      key: `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`,
      label: MONTHS[start.getUTCMonth()],
      start,
      end
    });
  }
  return buckets;
}

interface DailyAgg {
  [dayKeyStr: string]: { tempSum: number; humSum: number; count: number };
}

/**
 * Computes the AnalyticsOverview:
 *  - temperatureTrend / humidityTrend from DHT22 SensorData averaged per bucket
 *  - dryingCycles from DryingSessions started per bucket
 */
export async function computeAnalyticsOverview(
  period: AnalyticsPeriod
): Promise<{ temperatureTrend: TrendPoint[]; humidityTrend: TrendPoint[]; dryingCycles: TrendPoint[] }> {
  const buckets = buildBuckets(period);
  const overallStart = buckets[0].start;

  const sensorDaily = await SensorDatum.aggregate<{
    _id: string;
    tempSum: number;
    humSum: number;
    count: number;
  }>([
    { $match: { timestamp: { $gte: overallStart } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        tempSum: { $sum: '$temperature' },
        humSum: { $sum: '$humidity' },
        count: { $sum: 1 }
      }
    }
  ]);

  const sessionDaily = await DryingSession.aggregate<{ _id: string; count: number }>([
    { $match: { startedAt: { $gte: overallStart } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } },
        count: { $sum: 1 }
      }
    }
  ]);

  const dailyAgg: DailyAgg = {};
  for (const row of sensorDaily) {
    dailyAgg[row._id] = {
      tempSum: Number(row.tempSum) || 0,
      humSum: Number(row.humSum) || 0,
      count: Number(row.count) || 0
    };
  }

  const sessionCountByDay: Record<string, number> = {};
  for (const row of sessionDaily) {
    sessionCountByDay[row._id] = Number(row.count) || 0;
  }

  const temperatureTrend: TrendPoint[] = [];
  const humidityTrend: TrendPoint[] = [];
  const dryingCycles: TrendPoint[] = [];

  for (const bucket of buckets) {
    let tempSum = 0;
    let humSum = 0;
    let count = 0;
    let sessions = 0;

    for (let t = bucket.start.getTime(); t < bucket.end.getTime(); t += 86_400_000) {
      const k = dayKey(new Date(t));
      const agg = dailyAgg[k];
      if (agg && agg.count > 0) {
        tempSum += agg.tempSum;
        humSum += agg.humSum;
        count += agg.count;
      }
      sessions += sessionCountByDay[k] || 0;
    }

    temperatureTrend.push({ label: bucket.label, value: count > 0 ? round1(tempSum / count) : 0 });
    humidityTrend.push({ label: bucket.label, value: count > 0 ? round1(humSum / count) : 0 });
    dryingCycles.push({ label: bucket.label, value: sessions });
  }

  return { temperatureTrend, humidityTrend, dryingCycles };
}
