"""
Prediction microservice consumed by the Node backend (env.ML_SERVICE_URL).

Endpoints:
  GET  /health  -> { ok, modelVersion }
  POST /predict -> { remainingMinutes }   body = feature vector

Run:    uvicorn service:app --host 0.0.0.0 --port 8100  (from the ml/ folder)
Train first: python generate_synthetic_data.py && python train.py
"""

import json
import os

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

HERE = os.path.dirname(os.path.abspath(__file__))

FEATURES = [
    "elapsedMinutes",
    "temperature",
    "humidity",
    "rhGapToEquilibrium",
    "humidityRate15",
    "humidityRate30",
    "temperatureRate30",
]

app = FastAPI(title="grAIn drying-time predictor", version="1.0.0")

_bundle = None
_meta = None


def load_bundle():
    global _bundle, _meta
    if _bundle is None:
        path = os.path.join(HERE, "model.joblib")
        if not os.path.exists(path):
            raise RuntimeError(
                "model.joblib not found — run generate_synthetic_data.py and train.py first"
            )
        _bundle = joblib.load(path)
        meta_path = os.path.join(HERE, "model_metrics.json")
        _meta = {}
        if os.path.exists(meta_path):
            with open(meta_path, encoding="utf-8") as f:
                _meta = json.load(f)
    return _bundle


class Features(BaseModel):
    elapsedMinutes: float = Field(ge=0)
    temperature: float
    humidity: float
    rhGapToEquilibrium: float
    humidityRate15: float = 0.0
    humidityRate30: float = 0.0
    temperatureRate30: float = 0.0


@app.get("/health")
def health():
    try:
        bundle = load_bundle()
        version = (_meta or {}).get("modelVersion", "unknown")
        best = (_meta or {}).get("bestModel", "unknown")
        mae = (_meta or {}).get(best, {}).get("mae_minutes")
        return {
            "ok": True,
            "modelVersion": version,
            "bestModel": best,
            "testMaeMinutes": mae,
            "featureColumns": bundle["features"],
        }
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/predict")
def predict(features: Features):
    bundle = load_bundle()
    row = pd.DataFrame([{ name: getattr(features, name) for name in FEATURES }])
    prediction = float(bundle["model"].predict(row)[0])
    return {"remainingMinutes": max(0.0, round(prediction, 1))}