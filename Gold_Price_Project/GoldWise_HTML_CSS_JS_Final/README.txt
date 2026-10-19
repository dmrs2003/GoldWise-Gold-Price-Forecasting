GOLDWISE HTML/CSS/JS FINAL DASHBOARD
====================================

This version follows the requested design:
- dark green premium sidebar
- Dashboard / Prediction / Model Analysis / Data Insights / Settings / About
- gold accent colour
- modern KPI cards
- hero image
- Historical Gold Price chart
- Actual vs Predicted test-set chart
- model comparison
- feature influence
- no correlation heatmap

FILES
-----
app.py
templates/index.html
static/style.css
static/script.js
static/assets/gold_header.png
static/assets/gold_bars.png
requirements.txt

RUN
---
Open a terminal in this folder.

python -m pip install -r requirements.txt
python app.py

Then open:
http://127.0.0.1:5000

PROJECT DATA
------------
The app searches upward for:
Outputs/
Processed Data/

It loads:
Outputs/final_gold_price_model.joblib
Outputs/model_metadata.json

and automatically looks for:
- final_test_predictions.csv
- final_candidate_model_comparison.csv
- final_model_coefficients.csv

The dashboard does not retrain the model.
