"""
Trains the drying-time prediction models and benchmarks Random Forest against
gradient boosting (the capstone revision deliverable).

Input : CSV with columns produced by generate_synthetic_data.py (or exported
        real sessions with the same schema).
Output: ml/model.joblib (best pipeline), ml/model_metrics.json, ml/model_meta.json

Usage:  python ml/train.py [csv_path]

Models are evaluated with a GROUP split by sessionId so rows from the same
drying run never leak between train and test sets.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

FEATURES = [
    "elapsedMinutes",
    "temperature",
    "humidity",
    "rhGapToEquilibrium",
    "humidityRate15",
    "humidityRate30",
    "temperatureRate30",
]
TARGET = "remainingMinutes"


def try_xgboost():
    """Optional: use XGBoost when installed; otherwise sklearn's GBM is used."""
    try:
        from xgboost import XGBRegressor

        return XGBRegressor(
            n_estimators=400,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            n_jobs=-1,
        ), "xgboost"
    except ImportError:
        return GradientBoostingRegressor(
            n_estimators=400,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.9,
        ), "sklearn_gradient_boosting"


def metrics(y_true, y_pred):
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    return {
        "mae_minutes": round(float(mean_absolute_error(y_true, y_pred)), 2),
        "rmse_minutes": round(rmse, 2),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    csv_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "data", "synthetic_sessions.csv")
    if not os.path.exists(csv_path):
        raise SystemExit(f"Dataset not found: {csv_path}. Run generate_synthetic_data.py first.")

    df = pd.read_csv(csv_path)
    df = df.dropna(subset=FEATURES + [TARGET])
    groups = df["sessionId"]

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(df[FEATURES], df[TARGET], groups))
    X_train, X_test = df.iloc[train_idx][FEATURES], df.iloc[test_idx][FEATURES]
    y_train, y_test = df.iloc[train_idx][TARGET], df.iloc[test_idx][TARGET]
    print(f"Train sessions: {groups.iloc[train_idx].nunique()}  Test sessions: {groups.iloc[test_idx].nunique()}")

    results = {}

    rf = RandomForestRegressor(n_estimators=400, min_samples_leaf=2, n_jobs=-1, random_state=42)
    rf.fit(X_train, y_train)
    results["random_forest"] = {"metrics": metrics(y_test, rf.predict(X_test))}
    print("RandomForest          :", results["random_forest"]["metrics"])

    gb_name = "gradient_boosting"
    if try_xgboost()[1] == "xgboost":
        gb_name = "xgboost"
    gb_model, _ = try_xgboost()
    gb_model.fit(X_train, y_train)
    results[gb_name] = {"metrics": metrics(y_test, gb_model.predict(X_test))}
    print(f"{gb_name:22}:", results[gb_name]["metrics"])

    best_name = min(results, key=lambda k: results[k]["metrics"]["mae_minutes"])
    best_model = rf if best_name == "random_forest" else gb_model
    print(f"\nBest model by MAE: {best_name}")

    model_path = os.path.join(here, "model.joblib")
    joblib.dump({"model": best_model, "features": FEATURES}, model_path)

    model_hash = hashlib.sha256(open(model_path, "rb").read()).hexdigest()[:8]
    meta = {
        "bestModel": best_name,
        "modelVersion": f"{best_name}-{model_hash}",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "featureColumns": FEATURES,
        "trainRows": int(len(train_idx)),
        "testRows": int(len(test_idx)),
    }
    for name, info in results.items():
        meta[name] = info["metrics"]

    with open(os.path.join(here, "model_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"Saved {model_path}\nSaved ml/model_metrics.json")


if __name__ == "__main__":
    main()