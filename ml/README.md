# grAIn ML — drying-time prediction pipeline (DHT22-only)

Predictive-analytics component for the capstone: predicts **estimated remaining
drying time** and the **completion time** from temperature + humidity + elapsed
time patterns, trained on historical drying sessions.

## Scientific basis (no moisture sensor needed)

Grain state is inferred from exhaust-air equilibrium behaviour using the ASABE
D245 **Chung-Pfost** equation for rough rice:

```
ERH(T, M) = exp( -A/(T+C) · exp(-B·M) )      A=289.727  B=13.3862  C=32.442
```

As paddy rice dries toward ~14% moisture, exhaust RH falls toward the
equilibrium RH for that moisture at the current temperature and plateaus there.
That plateau is the observable end condition ("desired drying condition").
The system never claims to measure grain moisture directly — cite this in the paper.

## Files

| File | Purpose |
|---|---|
| `generate_synthetic_data.py` | Creates a realistic placeholder dataset so the whole pipeline runs before real trials exist |
| `train.py` | Trains & benchmarks **Random Forest vs gradient boosting (XGBoost if installed)** with a group split by session; saves the best model |
| `service.py` | FastAPI microservice consumed by the Node backend (`ML_SERVICE_URL`) |

## Run it

```bash
pip install -r ml/requirements.txt

python ml/generate_synthetic_data.py          # -> ml/data/synthetic_sessions.csv
python ml/train.py                            # -> ml/model.joblib, model_metrics.json
cd ml && uvicorn service:app --port 8100      # serves POST /predict
```

Then in the backend `.env`: `ML_SERVICE_URL=http://localhost:8100`
(leave unset to run on the physics-fallback estimator only).

## Swapping in REAL experimental data

1. Run consistent drying trials (same batch setup/procedure per run).
2. Export each session's readings to CSV with the exact columns produced by
   `generate_synthetic_data.py` (`sessionId, elapsedMinutes, temperature,
   humidity, rhGapToEquilibrium, humidityRate15, humidityRate30,
   temperatureRate30, remainingMinutes`), where `remainingMinutes = total
   session minutes − elapsed` for rows of completed sessions.
3. Concatenate them and run `python ml/train.py your_real_data.csv`.

Aim for 20–40+ sessions; metrics in `model_metrics.json` are your defense table.
