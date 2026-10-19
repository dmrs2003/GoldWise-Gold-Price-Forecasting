from pathlib import Path
import json
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

# ============================================================
# GOLDWISE - HTML / CSS / JAVASCRIPT DASHBOARD
# ============================================================

APP_DIR = Path(__file__).resolve().parent


def find_project_root():
    candidates = [APP_DIR, APP_DIR.parent, Path.cwd(), *APP_DIR.parents, *Path.cwd().parents]
    seen = set()

    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen:
            continue
        seen.add(candidate)

        if (candidate / "Outputs").exists() and (candidate / "Processed Data").exists():
            return candidate

    return APP_DIR


PROJECT_ROOT = find_project_root()
OUTPUTS = PROJECT_ROOT / "Outputs"
PROCESSED = PROJECT_ROOT / "Processed Data"

MODEL_PATH = OUTPUTS / "final_gold_price_model.joblib"
METADATA_PATH = OUTPUTS / "model_metadata.json"

DATA_CANDIDATES = [
    PROCESSED / "final_modeling_dataset_4_models.csv",
    PROCESSED / "final_modeling_dataset.csv",
    PROCESSED / "gold_price_7day_revised_modeling_dataset.csv",
    PROCESSED / "modeling_dataset.csv",
]

COMPARISON_CANDIDATES = [
    OUTPUTS / "final_candidate_model_comparison.csv",
    OUTPUTS / "train_validation_comparison.csv",
]

PREDICTION_CANDIDATES = [
    OUTPUTS / "final_test_predictions.csv",
    OUTPUTS / "test_predictions.csv",
]

FEATURE_CANDIDATES = [
    OUTPUTS / "final_model_coefficients.csv",
    OUTPUTS / "final_model_feature_importance.csv",
]


def first_existing(paths):
    for p in paths:
        if p.exists():
            return p
    return None


def read_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def clean_df(df):
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    if df.columns.duplicated().any():
        df = df.loc[:, ~df.columns.duplicated(keep="first")]
    return df


def read_csv(path):
    try:
        return clean_df(pd.read_csv(path))
    except Exception:
        return None


METADATA = read_json(METADATA_PATH)

try:
    MODEL = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None
except Exception:
    MODEL = None


def model_features():
    features = METADATA.get("features", [])
    if isinstance(features, list) and features:
        return list(dict.fromkeys(features))

    if MODEL is not None:
        if hasattr(MODEL, "feature_names_in_"):
            return list(MODEL.feature_names_in_)

        if hasattr(MODEL, "named_steps"):
            for estimator in MODEL.named_steps.values():
                if hasattr(estimator, "feature_names_in_"):
                    return list(estimator.feature_names_in_)

    return []


FEATURES = model_features()


def load_main_data():
    candidates = [p for p in DATA_CANDIDATES if p.exists()]

    if PROCESSED.exists():
        for p in sorted(PROCESSED.rglob("*.csv")):
            if p not in candidates:
                candidates.append(p)

    best = None
    best_score = -1

    for path in candidates:
        df = read_csv(path)
        if df is None or "Date" not in df.columns:
            continue

        score = sum(f in df.columns for f in FEATURES)
        score += 2 if "Gold_LKR" in df.columns else 0

        if score > best_score:
            best = df
            best_score = score

        if FEATURES and all(f in df.columns for f in FEATURES):
            break

    if best is None:
        return pd.DataFrame()

    best["Date"] = pd.to_datetime(best["Date"], errors="coerce")
    best = best.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)
    return add_features(best)


def add_features(df):
    df = clean_df(df)

    numeric = [
        "Open", "High", "Low", "Close", "Volume",
        "USD_LKR", "Gold_LKR"
    ]

    for c in numeric:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # Only create features when they do not already exist.
    if "Gold_LKR_Lag_7" not in df.columns and "Gold_LKR" in df.columns:
        df["Gold_LKR_Lag_7"] = df["Gold_LKR"].shift(7)

    if "Gold_LKR_MA_7" not in df.columns and "Gold_LKR" in df.columns:
        df["Gold_LKR_MA_7"] = df["Gold_LKR"].shift(1).rolling(7).mean()

    if "Gold_LKR_MA_30" not in df.columns and "Gold_LKR" in df.columns:
        df["Gold_LKR_MA_30"] = df["Gold_LKR"].shift(1).rolling(30).mean()

    if "Gold_LKR_Volatility_7" not in df.columns and "Gold_LKR" in df.columns:
        df["Gold_LKR_Volatility_7"] = df["Gold_LKR"].shift(1).rolling(7).std()

    if "Gold_LKR_Return_1" not in df.columns and "Gold_LKR" in df.columns:
        df["Gold_LKR_Return_1"] = df["Gold_LKR"].pct_change()

    if "USD_LKR_Lag_7" not in df.columns and "USD_LKR" in df.columns:
        df["USD_LKR_Lag_7"] = df["USD_LKR"].shift(7)

    if "USD_LKR_Return_1" not in df.columns and "USD_LKR" in df.columns:
        df["USD_LKR_Return_1"] = df["USD_LKR"].pct_change()

    return df


DATA = load_main_data()


def pick_prediction_file():
    path = first_existing(PREDICTION_CANDIDATES)
    if path:
        return read_csv(path)

    if OUTPUTS.exists():
        for p in OUTPUTS.glob("*.csv"):
            name = p.name.lower()
            if "prediction" in name:
                df = read_csv(p)
                if df is not None:
                    return df

    return pd.DataFrame()


PREDICTIONS = pick_prediction_file()


def pick_comparison_file():
    path = first_existing(COMPARISON_CANDIDATES)
    return read_csv(path) if path else pd.DataFrame()


COMPARISON = pick_comparison_file()


def pick_feature_file():
    path = first_existing(FEATURE_CANDIDATES)
    return read_csv(path) if path else pd.DataFrame()


FEATURE_TABLE = pick_feature_file()


def metric_value(section, names, fallback=None):
    for name in names:
        if isinstance(section, dict) and name in section:
            return section[name]
    return fallback


def performance():
    validation = METADATA.get("validation_metrics", {})
    test = METADATA.get("test_metrics", {})

    return {
        "model": METADATA.get(
            "selected_model",
            METADATA.get("model_name", "Linear Regression")
        ),
        "validation_r2": metric_value(
            validation, ["R2"], METADATA.get("validation_R2")
        ),
        "validation_rmse": metric_value(
            validation, ["RMSE"], METADATA.get("validation_RMSE")
        ),
        "validation_mae": metric_value(
            validation, ["MAE"], METADATA.get("validation_MAE")
        ),
        "test_r2": metric_value(
            test, ["R2"], METADATA.get("test_R2")
        ),
        "test_rmse": metric_value(
            test, ["RMSE"], METADATA.get("test_RMSE")
        ),
        "test_mae": metric_value(
            test, ["MAE"], METADATA.get("test_MAE")
        ),
        "test_mape": metric_value(
            test, ["MAPE (%)", "MAPE"], METADATA.get("test_MAPE")
        ),
    }


def numeric(v):
    try:
        x = float(v)
        return None if not np.isfinite(x) else x
    except Exception:
        return None


def find_col(df, names):
    lower = {str(c).lower(): c for c in df.columns}

    for name in names:
        if name.lower() in lower:
            return lower[name.lower()]

    for c in df.columns:
        lc = str(c).lower()
        if any(name.lower() in lc for name in names):
            return c

    return None


def predict_for_row(row):
    if MODEL is None:
        return None, "Saved model was not found."

    missing = [f for f in FEATURES if f not in row.index]
    if missing:
        return None, "Missing model features: " + ", ".join(missing)

    nulls = [f for f in FEATURES if pd.isna(row[f])]
    if nulls:
        return None, "The selected date is not model-ready. Missing: " + ", ".join(nulls)

    X = pd.DataFrame([{f: row[f] for f in FEATURES}])
    try:
        return float(MODEL.predict(X)[0]), None
    except Exception as exc:
        return None, str(exc)


def row_payload(row):
    current = None
    for c in ["Gold_LKR", "Current_Gold_LKR", "Gold_Price_LKR"]:
        if c in row.index and pd.notna(row[c]):
            current = numeric(row[c])
            break

    prediction, error = predict_for_row(row)

    if prediction is None:
        return {
            "date": row["Date"].strftime("%Y-%m-%d"),
            "date_label": row["Date"].strftime("%d %b %Y"),
            "current": current,
            "prediction": None,
            "error": error,
        }

    target_date = row["Date"] + pd.Timedelta(days=7)
    change = prediction - current if current is not None else None
    change_pct = (change / current * 100) if current else None

    if change_pct is None:
        decision = "MONITOR"
        decision_text = "Current reference price is unavailable."
    elif change_pct > 0.50:
        decision = "BUY NOW"
        decision_text = f"The model predicts an increase of {change_pct:.2f}% over the forecast horizon."
    elif change_pct < -0.50:
        decision = "WAIT"
        decision_text = f"The model predicts a decrease of {abs(change_pct):.2f}% over the forecast horizon."
    else:
        decision = "MONITOR"
        decision_text = f"The expected movement is {change_pct:.2f}%, so monitoring is recommended."

    return {
        "date": row["Date"].strftime("%Y-%m-%d"),
        "date_label": row["Date"].strftime("%d %b %Y"),
        "target_date": target_date.strftime("%Y-%m-%d"),
        "target_label": target_date.strftime("%d %b %Y"),
        "current": current,
        "prediction": prediction,
        "change": change,
        "change_pct": change_pct,
        "decision": decision,
        "decision_text": decision_text,
        "error": None,
    }


app = Flask(__name__, template_folder="templates", static_folder="static")


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/bootstrap")
def bootstrap():
    if DATA.empty:
        return jsonify({
            "ok": False,
            "error": "No processed modelling dataset was found.",
            "dates": [],
        })

    usable = DATA.copy()

    if FEATURES:
        usable = usable.dropna(subset=[f for f in FEATURES if f in usable.columns])

    dates = [
        d.strftime("%Y-%m-%d")
        for d in usable["Date"]
    ]

    default_date = dates[-1] if dates else None

    selected = None
    if default_date:
        selected = usable[usable["Date"].dt.strftime("%Y-%m-%d") == default_date].iloc[-1]

    summary = row_payload(selected) if selected is not None else None

    return jsonify({
        "ok": True,
        "dates": dates,
        "default_date": default_date,
        "summary": summary,
        "performance": performance(),
        "model_features": FEATURES,
        "model_name": performance()["model"],
    })


@app.get("/api/forecast")
def forecast():
    requested = request.args.get("date")

    if DATA.empty:
        return jsonify({"ok": False, "error": "Dataset not found."}), 404

    usable = DATA.copy()

    if requested:
        mask = usable["Date"].dt.strftime("%Y-%m-%d") == requested
        rows = usable[mask]
    else:
        rows = usable.tail(1)

    if rows.empty:
        return jsonify({"ok": False, "error": "Date not found."}), 404

    result = row_payload(rows.iloc[-1])
    result["ok"] = result["error"] is None
    return jsonify(result)


@app.get("/api/history")
def history():
    limit = min(max(int(request.args.get("limit", 365)), 30), 1000)

    if DATA.empty or "Gold_LKR" not in DATA.columns:
        return jsonify({"dates": [], "values": []})

    frame = DATA[["Date", "Gold_LKR"]].dropna().tail(limit)

    return jsonify({
        "dates": frame["Date"].dt.strftime("%Y-%m-%d").tolist(),
        "values": [numeric(v) for v in frame["Gold_LKR"]],
    })


@app.get("/api/actual-predicted")
def actual_predicted():
    df = PREDICTIONS.copy()

    if df.empty:
        return jsonify({"dates": [], "actual": [], "predicted": []})

    date_col = find_col(df, ["Date", "Target_Date", "Target Date"])
    actual_col = find_col(df, ["Actual", "Actual_Gold_LKR", "y_true", "True"])
    predicted_col = find_col(df, ["Predicted", "Predicted_Gold_LKR", "Prediction", "y_pred"])

    if actual_col is None or predicted_col is None:
        numeric_cols = df.select_dtypes(include=np.number).columns.tolist()
        if len(numeric_cols) >= 2:
            actual_col = actual_col or numeric_cols[0]
            predicted_col = predicted_col or numeric_cols[1]

    if actual_col is None or predicted_col is None:
        return jsonify({"dates": [], "actual": [], "predicted": []})

    dates = (
        pd.to_datetime(df[date_col], errors="coerce").dt.strftime("%Y-%m-%d").tolist()
        if date_col
        else list(range(len(df)))
    )

    return jsonify({
        "dates": dates,
        "actual": [numeric(v) for v in df[actual_col]],
        "predicted": [numeric(v) for v in df[predicted_col]],
    })


@app.get("/api/model-comparison")
def model_comparison():
    df = COMPARISON.copy()

    if df.empty:
        return jsonify({"models": [], "rmse": []})

    model_col = find_col(df, ["Model"])
    rmse_col = find_col(
        df,
        ["Validation RMSE", "Val RMSE", "RMSE"]
    )

    if model_col is None or rmse_col is None:
        return jsonify({"models": [], "rmse": []})

    frame = df[[model_col, rmse_col]].copy()
    frame[rmse_col] = pd.to_numeric(frame[rmse_col], errors="coerce")
    frame = frame.dropna().sort_values(rmse_col)

    return jsonify({
        "models": frame[model_col].astype(str).tolist(),
        "rmse": [numeric(v) for v in frame[rmse_col]],
    })


@app.get("/api/features")
def features():
    df = FEATURE_TABLE.copy()

    if not df.empty:
        name_col = find_col(
            df,
            ["Feature", "feature", "Variable", "Name"]
        )

        value_col = find_col(
            df,
            ["Coefficient", "Importance", "Value", "coefficient"]
        )

        if name_col and value_col:
            frame = df[[name_col, value_col]].copy()
            frame[value_col] = pd.to_numeric(
                frame[value_col],
                errors="coerce"
            )
            frame = frame.dropna().copy()
            frame["abs"] = frame[value_col].abs()
            frame = frame.sort_values("abs", ascending=False).head(10)

            return jsonify({
                "features": frame[name_col].astype(str).tolist(),
                "values": [numeric(v) for v in frame[value_col]],
                "kind": "Coefficient / Importance",
            })

    # Try extracting coefficients from a linear regression / pipeline.
    if MODEL is not None:
        estimator = MODEL

        if hasattr(MODEL, "named_steps"):
            estimator = list(MODEL.named_steps.values())[-1]

        if hasattr(estimator, "coef_") and FEATURES:
            coefs = np.asarray(estimator.coef_).reshape(-1)

            if len(coefs) == len(FEATURES):
                pairs = sorted(
                    zip(FEATURES, coefs),
                    key=lambda x: abs(float(x[1])),
                    reverse=True
                )[:10]

                return jsonify({
                    "features": [x[0] for x in pairs],
                    "values": [numeric(x[1]) for x in pairs],
                    "kind": "Coefficient",
                })

    return jsonify({
        "features": [],
        "values": [],
        "kind": "Coefficient / Importance",
    })


@app.get("/api/insights")
def insights():
    return jsonify({
        "items": [
            {
                "title": "7-day forecast",
                "text": "The final model is used to estimate the target gold price approximately seven calendar days ahead."
            },
            {
                "title": "Decision support",
                "text": "The dashboard compares the current reference price with the model forecast to produce a simple purchasing signal."
            },
            {
                "title": "Model validation",
                "text": "Validation and unseen-test metrics are displayed separately so model quality can be assessed without confusing training performance with generalisation."
            },
            {
                "title": "Actual vs predicted",
                "text": "The test-set chart provides a visual check of how closely predictions follow the observed target values."
            },
        ]
    })


@app.get("/api/health")
def health():
    return jsonify({
        "model_loaded": MODEL is not None,
        "dataset_loaded": not DATA.empty,
        "model_path": str(MODEL_PATH),
        "project_root": str(PROJECT_ROOT),
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
