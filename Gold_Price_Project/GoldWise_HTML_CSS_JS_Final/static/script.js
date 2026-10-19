let state = {
    dates: [],
    history: null,
    actualPredicted: null,
    comparison: null,
    features: null,
    performance: null,
    currentForecast: null
};

const $ = (selector) => document.querySelector(selector);

function formatMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }

    return "Rs. " + Math.round(Number(value)).toLocaleString("en-LK");
}

function formatCompactMoney(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }

    const n = Number(value);

    if (Math.abs(n) >= 1000000) {
        return "Rs. " + (n / 1000000).toFixed(2) + "M";
    }

    if (Math.abs(n) >= 1000) {
        return "Rs. " + (n / 1000).toFixed(1) + "K";
    }

    return "Rs. " + Math.round(n).toLocaleString("en-LK");
}

function formatPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }

    const n = Number(value);
    return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2) + "%";
}

function formatNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "—";
    }

    return Number(value).toLocaleString("en-LK", {
        maximumFractionDigits: 0
    });
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* -----------------------------------------------------------
   Navigation
----------------------------------------------------------- */

function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach(button => {
        button.addEventListener("click", () => {

            document.querySelectorAll(".nav-item")
                .forEach(item => item.classList.remove("active"));

            button.classList.add("active");

            const sectionId = button.dataset.section;

            document.querySelectorAll(".page-section")
                .forEach(section => section.classList.remove("active-section"));

            const target = document.getElementById(sectionId);

            if (target) {
                target.classList.add("active-section");
            }

            document.querySelector(".sidebar")?.classList.remove("open");

            if (sectionId === "model-analysis") {
                renderModelCharts();
            }

            if (sectionId === "data-insights") {
                renderInsights();
            }
        });
    });

    $("#mobileMenu")?.addEventListener("click", () => {
        $(".sidebar")?.classList.toggle("open");
    });
}


/* -----------------------------------------------------------
   API
----------------------------------------------------------- */

async function getJSON(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}


/* -----------------------------------------------------------
   Forecast
----------------------------------------------------------- */

function applyForecast(data) {

    state.currentForecast = data;

    $("#selectedDateLabel").textContent = data.date_label || "—";

    $("#currentPrice").textContent =
        formatMoney(data.current);

    $("#predictedPrice").textContent =
        formatMoney(data.prediction);

    $("#targetDate").textContent =
        "Target: " + (data.target_label || "—");

    $("#expectedChange").textContent =
        data.change === null || data.change === undefined
            ? "—"
            : (data.change >= 0 ? "+" : "−") +
              formatCompactMoney(Math.abs(data.change));

    $("#expectedChangePct").textContent =
        formatPercent(data.change_pct);

    $("#decisionValue").textContent =
        data.decision || "MONITOR";

    $("#decisionText").textContent =
        data.decision_text || "—";

    $("#predictionBig").textContent =
        formatMoney(data.prediction);

    $("#predictionTarget").textContent =
        "Target: " + (data.target_label || "—");

    $("#predictionCurrent").textContent =
        formatMoney(data.current);

    $("#predictionMovement").textContent =
        formatPercent(data.change_pct);

    $("#predictionDecision").textContent =
        data.decision || "—";

    const decision = data.decision;

    const decisionEl = $("#decisionValue");

    decisionEl.style.color =
        decision === "BUY NOW"
            ? "var(--green)"
            : decision === "WAIT"
                ? "var(--red)"
                : "var(--gold)";

    $("#dateSelect").value = data.date;

    if (state.history) {
        renderHistoryChart(data);
    }
}


/* -----------------------------------------------------------
   Dropdown
----------------------------------------------------------- */

function setupDateSelector() {
    const select = $("#dateSelect");

    select.addEventListener("change", async () => {

        const date = select.value;

        try {
            const data = await getJSON(
                `/api/forecast?date=${encodeURIComponent(date)}`
            );

            if (data.ok) {
                applyForecast(data);
            } else {
                console.error(data.error);
            }

        } catch (error) {
            console.error(error);
        }
    });
}


/* -----------------------------------------------------------
   Canvas helpers
----------------------------------------------------------- */

function setupCanvas(canvas) {
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    return {
        ctx,
        width: rect.width,
        height: rect.height
    };
}

function clearCanvas(canvas, ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#091b12";
    ctx.fillRect(0, 0, width, height);
}

function chartRange(values) {
    const clean = values
        .map(Number)
        .filter(Number.isFinite);

    if (!clean.length) {
        return { min: 0, max: 1 };
    }

    const min = Math.min(...clean);
    const max = Math.max(...clean);

    const pad = Math.max((max - min) * 0.08, 1);

    return {
        min: min - pad,
        max: max + pad
    };
}

function xPosition(index, length, left, plotWidth) {
    if (length <= 1) return left;
    return left + (index / (length - 1)) * plotWidth;
}

function yPosition(value, min, max, top, plotHeight) {
    return top + (1 - ((value - min) / (max - min))) * plotHeight;
}

function drawGrid(ctx, left, top, plotWidth, plotHeight) {

    ctx.strokeStyle = "#173022";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = top + (plotHeight / 4) * i;

        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotWidth, y);
        ctx.stroke();
    }
}

function drawLegend(ctx, items, x, y) {
    ctx.font = "11px Inter, sans-serif";

    let offset = 0;

    items.forEach(item => {
        ctx.fillStyle = item.color;

        ctx.fillRect(
            x + offset,
            y - 8,
            20,
            3
        );

        ctx.fillStyle = "#8ea097";
        ctx.fillText(
            item.label,
            x + offset + 27,
            y
        );

        offset += ctx.measureText(item.label).width + 65;
    });
}

function drawLine(ctx, values, color, left, top, plotWidth, plotHeight, min, max) {

    const valid = values
        .map(v => Number(v));

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();

    let started = false;

    valid.forEach((value, index) => {

        if (!Number.isFinite(value)) {
            return;
        }

        const x = xPosition(
            index,
            valid.length,
            left,
            plotWidth
        );

        const y = yPosition(
            value,
            min,
            max,
            top,
            plotHeight
        );

        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}


/* -----------------------------------------------------------
   Historical chart
----------------------------------------------------------- */

function renderHistoryChart(forecast = null) {

    const canvas = $("#historyChart");
    const setup = setupCanvas(canvas);

    if (!setup || !state.history) return;

    const { ctx, width, height } = setup;

    clearCanvas(
        canvas,
        ctx,
        width,
        height
    );

    const values = state.history.values;

    const range = chartRange(values);

    const left = 55;
    const right = 22;
    const top = 28;
    const bottom = 38;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    drawGrid(
        ctx,
        left,
        top,
        plotWidth,
        plotHeight
    );

    drawLine(
        ctx,
        values,
        "#e4c15b",
        left,
        top,
        plotWidth,
        plotHeight,
        range.min,
        range.max
    );

    if (
        forecast &&
        forecast.current !== null &&
        forecast.prediction !== null
    ) {

        const currentIndex = values.length - 1;

        const x1 = xPosition(
            currentIndex,
            values.length,
            left,
            plotWidth
        );

        const x2 = Math.min(
            width - right,
            x1 + Math.max(40, plotWidth * .035)
        );

        const y1 = yPosition(
            forecast.current,
            range.min,
            range.max,
            top,
            plotHeight
        );

        const y2 = yPosition(
            forecast.prediction,
            range.min,
            range.max,
            top,
            plotHeight
        );

        ctx.strokeStyle = "#8fdc72";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 6]);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.setLineDash([]);

        ctx.fillStyle = "#8fdc72";
        ctx.beginPath();
        ctx.arc(x2, y2, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    drawLegend(
        ctx,
        [
            {
                label: "Historical Price",
                color: "#e4c15b"
            },
            {
                label: "7-Day Forecast",
                color: "#8fdc72"
            }
        ],
        left,
        17
    );

    ctx.fillStyle = "#63766b";
    ctx.font = "10px Inter, sans-serif";
    ctx.fillText(
        "LKR",
        10,
        top + 4
    );

    ctx.fillText(
        "Historical period",
        left,
        height - 11
    );
}


/* -----------------------------------------------------------
   Actual vs Predicted
----------------------------------------------------------- */

function renderActualPredicted() {

    const canvas = $("#actualPredictedChart");
    const setup = setupCanvas(canvas);

    if (!setup || !state.actualPredicted) return;

    const { ctx, width, height } = setup;

    clearCanvas(
        canvas,
        ctx,
        width,
        height
    );

    const actual = state.actualPredicted.actual || [];
    const predicted = state.actualPredicted.predicted || [];

    const all = [...actual, ...predicted];

    const range = chartRange(all);

    const left = 52;
    const right = 18;
    const top = 32;
    const bottom = 34;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    drawGrid(
        ctx,
        left,
        top,
        plotWidth,
        plotHeight
    );

    drawLine(
        ctx,
        actual,
        "#5ca9ff",
        left,
        top,
        plotWidth,
        plotHeight,
        range.min,
        range.max
    );

    drawLine(
        ctx,
        predicted,
        "#c49cff",
        left,
        top,
        plotWidth,
        plotHeight,
        range.min,
        range.max
    );

    drawLegend(
        ctx,
        [
            {
                label: "Actual Price",
                color: "#5ca9ff"
            },
            {
                label: "Predicted Price",
                color: "#c49cff"
            }
        ],
        left,
        18
    );
}


/* -----------------------------------------------------------
   Model comparison
----------------------------------------------------------- */

function renderModelComparison() {

    const canvas = $("#modelComparisonChart");
    const setup = setupCanvas(canvas);

    if (!setup || !state.comparison) return;

    const { ctx, width, height } = setup;

    clearCanvas(
        canvas,
        ctx,
        width,
        height
    );

    const labels = state.comparison.models || [];
    const values = state.comparison.rmse || [];

    if (!labels.length) {
        drawEmpty(
            ctx,
            width,
            height,
            "Model comparison output not found"
        );
        return;
    }

    const max = Math.max(...values) * 1.15;

    const left = 130;
    const right = 28;
    const top = 30;
    const rowHeight = Math.min(
        58,
        (height - 55) / labels.length
    );

    labels.forEach((label, index) => {

        const y =
            top
            + index * rowHeight
            + 8;

        const barWidth =
            (values[index] / max)
            * (width - left - right);

        ctx.fillStyle =
            index === 0
                ? "#e4c15b"
                : "#557a5a";

        ctx.fillRect(
            left,
            y,
            Math.max(barWidth, 3),
            24
        );

        ctx.fillStyle = "#a7b4aa";
        ctx.font = "10px Inter, sans-serif";
        ctx.fillText(
            label,
            5,
            y + 16
        );

        ctx.fillStyle = "#8e9c93";
        ctx.fillText(
            formatCompactMoney(values[index]),
            Math.min(
                left + barWidth + 8,
                width - 90
            ),
            y + 16
        );
    });
}


/* -----------------------------------------------------------
   Feature influence
----------------------------------------------------------- */

function renderFeatures() {

    const canvas = $("#featureChart");
    const setup = setupCanvas(canvas);

    if (!setup || !state.features) return;

    const { ctx, width, height } = setup;

    clearCanvas(
        canvas,
        ctx,
        width,
        height
    );

    const labels = state.features.features || [];
    const values = state.features.values || [];

    if (!labels.length) {
        drawEmpty(
            ctx,
            width,
            height,
            "Feature coefficient output not found"
        );
        return;
    }

    const maxAbs = Math.max(
        ...values.map(v => Math.abs(Number(v)))
    ) || 1;

    const left = 120;
    const center = width * .52;
    const right = 25;
    const top = 30;
    const rowHeight = Math.min(
        35,
        (height - 50) / labels.length
    );

    ctx.strokeStyle = "#304838";
    ctx.beginPath();
    ctx.moveTo(center, top - 8);
    ctx.lineTo(center, height - 20);
    ctx.stroke();

    labels.forEach((label, index) => {

        const value = Number(values[index]);

        const y =
            top
            + index * rowHeight
            + 3;

        const length =
            (Math.abs(value) / maxAbs)
            * (width * .31);

        ctx.fillStyle =
            value >= 0
                ? "#d0b45d"
                : "#6c8c6d";

        if (value >= 0) {
            ctx.fillRect(
                center,
                y,
                length,
                20
            );
        } else {
            ctx.fillRect(
                center - length,
                y,
                length,
                20
            );
        }

        ctx.fillStyle = "#8c9c92";
        ctx.font = "9px Inter, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(
            label.length > 18
                ? label.slice(0, 18) + "…"
                : label,
            left,
            y + 14
        );

        ctx.textAlign = "left";
    });
}


/* -----------------------------------------------------------
   Empty state
----------------------------------------------------------- */

function drawEmpty(ctx, width, height, text) {

    ctx.fillStyle = "#68796f";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "center";

    ctx.fillText(
        text,
        width / 2,
        height / 2
    );

    ctx.textAlign = "left";
}


/* -----------------------------------------------------------
   Model section
----------------------------------------------------------- */

function renderModelMetrics() {

    const p = state.performance || {};

    $("#validationR2").textContent =
        p.validation_r2 == null
            ? "—"
            : Number(p.validation_r2).toFixed(4);

    $("#validationRMSE").textContent =
        formatMoney(p.validation_rmse);

    $("#testR2").textContent =
        p.test_r2 == null
            ? "—"
            : Number(p.test_r2).toFixed(4);

    $("#testMAPE").textContent =
        p.test_mape == null
            ? "—"
            : Number(p.test_mape).toFixed(2) + "%";

    $("#modelName").textContent =
        p.model || "—";

    $("#settingsModel").textContent =
        p.model || "—";
}

function renderModelCharts() {
    setTimeout(() => {
        renderModelComparison();
        renderFeatures();
    }, 40);
}


/* -----------------------------------------------------------
   Insights
----------------------------------------------------------- */

function renderInsights() {

    const container = $("#insightGrid");

    if (!state.insights) return;

    container.innerHTML =
        state.insights.items.map(item => `
            <article class="insight-card">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.text)}</p>
            </article>
        `).join("");

    const chips = $("#featureChips");

    chips.innerHTML =
        (state.modelFeatures || []).map(feature => `
            <span class="feature-chip">
                ${escapeHtml(feature)}
            </span>
        `).join("");
}


/* -----------------------------------------------------------
   Resize
----------------------------------------------------------- */

let resizeTimer;

window.addEventListener("resize", () => {

    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {

        if (state.history) {
            renderHistoryChart(state.currentForecast);
        }

        if (state.actualPredicted) {
            renderActualPredicted();
        }

        if (
            document.querySelector("#model-analysis")
                ?.classList.contains("active-section")
        ) {
            renderModelCharts();
        }

    }, 120);
});


/* -----------------------------------------------------------
   Bootstrap
----------------------------------------------------------- */

async function bootstrap() {

    setupNavigation();
    setupDateSelector();

    try {

        const data = await getJSON("/api/bootstrap");

        if (!data.ok) {
            console.error(data.error);
            return;
        }

        state.dates = data.dates || [];
        state.performance = data.performance || {};
        state.modelFeatures = data.model_features || [];

        const select = $("#dateSelect");

        select.innerHTML =
            state.dates.map(date => {
                const d = new Date(date + "T00:00:00");

                return `
                    <option value="${date}">
                        ${d.toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric"
                        })}
                    </option>
                `;
            }).join("");

        if (data.default_date) {
            select.value = data.default_date;
        }

        if (data.summary) {
            applyForecast(data.summary);
        }

        renderModelMetrics();

        $("#modelName").textContent =
            data.model_name || "—";

        $("#settingsModel").textContent =
            data.model_name || "—";

        state.history =
            await getJSON("/api/history?limit=500");

        state.actualPredicted =
            await getJSON("/api/actual-predicted");

        state.comparison =
            await getJSON("/api/model-comparison");

        state.features =
            await getJSON("/api/features");

        state.insights =
            await getJSON("/api/insights");

        renderHistoryChart(data.summary);
        renderActualPredicted();
        renderInsights();

    } catch (error) {

        console.error(error);

        $("#currentPrice").textContent = "DATA ERROR";
        $("#predictedPrice").textContent = "CHECK API";
    }
}

document.addEventListener(
    "DOMContentLoaded",
    bootstrap
);
