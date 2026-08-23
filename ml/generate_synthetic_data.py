"""
Synthetic drying-session generator for pipeline validation.

Produces DHT22-only feature rows identical to what the Node backend extracts
from SensorDatum history (see src/services/predictionService.ts). Ground truth
labels (remainingMinutes) come from a thin-layer (Page) moisture decay model,
so once REAL experimental sessions are collected with the same schema, they can
replace this file's output without touching train.py.

Usage:  python ml/generate_synthetic_data.py [num_sessions] [out_csv]
"""

import csv
import math
import os
import random
import sys

# Chung-Pfost ERH for rough rice (ASABE D245) — mirrors src/services/emc.ts
A_CP, B_CP, C_CP = 289.727, 13.3862, 32.442


def equilibrium_rh(temp_c: float, moisture: float) -> float:
    """ERH (%) of air in balance with rough rice at temp_c, moisture (decimal wb)."""
    m = min(0.40, max(0.05, moisture))
    return min(100.0, max(0.0, math.exp((-A_CP / (temp_c + C_CP)) * math.exp(-B_CP * m)) * 100))


def completion_threshold(temp_c: float, target_pct: float) -> float:
    return min(99.0, equilibrium_rh(temp_c, target_pct / 100.0) + 1.0)


def slope_per_minute(series, window_min):
    """Least-squares slope (units/minute) over the trailing window of [(t, v)]."""
    if len(series) < 2:
        return 0.0
    t_end = series[-1][0]
    pts = [(t, v) for t, v in series if t >= t_end - window_min]
    if len(pts) < 2:
        return 0.0
    t0 = pts[0][0]
    xs = [(t - t0) for t, _ in pts]  # t is already in minutes
    ys = [v for _, v in pts]
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        return 0.0
    return (n * sxy - sx * sy) / denom


def simulate_session(rng, session_id, dt=5.0):
    """One drying run (t in MINUTES): Page-model moisture decay -> exhaust RH."""
    m0 = rng.uniform(20.0, 28.0)                # initial moisture (% wet basis)
    meq = rng.uniform(6.5, 9.0)                  # EMC at drying temperature (% wb)
    base_temp = rng.uniform(40.0, 55.0)          # heater setpoint band
    # k calibrated so runs last roughly 4-12 hours across the setpoint band:
    k = 0.0016 * math.exp(0.03 * (base_temp - 45)) * rng.uniform(0.75, 1.35)
    n_page = rng.uniform(0.75, 1.30)
    target = 14.0                                # % wet basis end condition
    ambient_rh = rng.uniform(72.0, 88.0)

    rows, temp_series, rh_series = [], [], []
    t, m = 0.0, m0
    while True:
        mr = math.exp(-k * max(t, 1e-6) ** n_page)
        m = meq + (m0 - meq) * mr                 # % wet basis
        temp = base_temp + math.sin(t / 90.0) * 1.5 + rng.gauss(0, 0.4)
        exhaust_rh = equilibrium_rh(temp, m / 100.0)
        # early on, air hasn't fully equilibrated with the grain layer yet
        blend = min(1.0, t / 45.0)
        measured_rh = ambient_rh * (1 - blend) + exhaust_rh * blend + rng.gauss(0, 0.8)
        measured_rh = min(98.0, max(15.0, measured_rh))

        elapsed = t
        remaining = None  # filled after we know session length
        rows.append([session_id, elapsed, round(temp, 2), round(measured_rh, 2)])
        temp_series.append((t, temp))
        rh_series.append((t, measured_rh))
        if m <= target:
            break
        t += dt
        if t > 16 * 60:  # safety cap (16 h)
            break

    total_minutes = rows[-1][1]
    out = []
    for i, (sid, elapsed, temp, rh) in enumerate(rows):
        eq_thr = completion_threshold(temp, target)
        out.append({
            "sessionId": sid,
            "elapsedMinutes": round(elapsed, 3),
            "temperature": temp,
            "humidity": rh,
            "rhGapToEquilibrium": round(rh - eq_thr, 3),
            "humidityRate15": round(slope_per_minute(rh_series[: i + 1], 15), 4),
            "humidityRate30": round(slope_per_minute(rh_series[: i + 1], 30), 4),
            "temperatureRate30": round(slope_per_minute(temp_series[: i + 1], 30), 4),
            "remainingMinutes": round(max(0.0, total_minutes - elapsed), 3),
        })
    return out


def main():
    num_sessions = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data", "synthetic_sessions.csv"
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    rng = random.Random(42)
    all_rows = []
    for i in range(num_sessions):
        all_rows.extend(simulate_session(rng, f"synthetic-{i:04d}"))

    fieldnames = [
        "sessionId", "elapsedMinutes", "temperature", "humidity",
        "rhGapToEquilibrium", "humidityRate15", "humidityRate30",
        "temperatureRate30", "remainingMinutes",
    ]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"Wrote {len(all_rows)} rows from {num_sessions} synthetic sessions -> {out_path}")


if __name__ == "__main__":
    main()