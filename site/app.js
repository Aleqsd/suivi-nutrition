const state = {
  dashboard: null,
  nutritionScope: "all",
  nutritionWindowDays: "30",
  mealTypeFilter: "all",
  mealsPage: 1,
  foodsPage: 1,
  foodSort: "occurrence",
  foodSortDirection: "desc",
  refreshTimer: null,
  refreshInFlight: false,
  renderSignatures: {},
};

const REFRESH_INTERVAL_MS = 60000;
const MEALS_PER_PAGE = 3;
const FOODS_PER_PAGE = 10;
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  weekday: "long",
});
const FRESHNESS_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Paris",
  hour12: false,
});

class AuthRedirectError extends Error {
  constructor(reason = "expired") {
    super("Session expirée ou accès protégé indisponible.");
    this.name = "AuthRedirectError";
    this.reason = reason;
  }
}

function redirectToLogin(reason = "expired") {
  if (document.body.dataset.page === "app") {
    document.body.dataset.authState = "pending";
  }
  const url = new URL("/", window.location.origin);
  if (reason) url.searchParams.set("auth", reason);
  window.location.replace(url.toString());
}

function isUnauthorizedDashboardResponse(response) {
  const finalUrl = new URL(response.url, window.location.origin);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return (
    finalUrl.pathname === "/"
    || finalUrl.pathname === "/index.html"
    || (response.redirected && !finalUrl.pathname.startsWith("/app/"))
    || contentType.includes("text/html")
  );
}

async function loadDashboard() {
  const response = await fetch("./data/dashboard.json", {
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });
  if (isUnauthorizedDashboardResponse(response)) {
    throw new AuthRedirectError();
  }
  if (!response.ok) throw new Error(`Failed to load dashboard data: ${response.status}`);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected dashboard content type: ${contentType || "unknown"}`);
  }
  return response.json();
}

async function waitForAuthBootstrap() {
  const authReady = window.__atlasAuthReady;
  if (!authReady || typeof authReady.then !== "function") return;
  const result = await authReady;
  if (result?.authorized === false) {
    throw new AuthRedirectError(result.reason || "expired");
  }
}

function markAppHydrated() {
  if (document.body.dataset.page !== "app") return;
  document.body.dataset.authState = "hydrated";
}

function prettyActivity(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

function parseDateText(value) {
  if (!value) return null;
  const text = String(value).trim().slice(0, 10);
  const parts = text.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.valueOf())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseMonthToDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  const [year, month] = text.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatShortDate(value) {
  const date = parseDateText(value);
  if (!date) return String(value || "Date inconnue");
  return SHORT_DATE_FORMATTER.format(date);
}

function getDashboardReferenceDate(data) {
  const meals = Array.isArray(data?.recentMeals) ? data.recentMeals : [];
  const mealDates = meals
    .map((meal) => parseDateText(meal.date))
    .filter(Boolean)
    .sort((a, b) => b - a);
  if (mealDates.length) return mealDates[0];
  const generatedAt = parseDateText(data?.generatedAt);
  if (generatedAt) return generatedAt;
  return new Date();
}

function getWindowDateRange(data, days) {
  const windowDays = Number(days) || 30;
  const endDate = getDashboardReferenceDate(data);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - Math.max(windowDays, 1) + 1);
  return {
    startDate,
    endDate,
  };
}

function filterByWindowDate(rows, dateKey, days, referenceDate) {
  const endDate = referenceDate instanceof Date ? referenceDate : getDashboardReferenceDate({ generatedAt: referenceDate });
  const cutoff = getWindowDateRange({ generatedAt: endDate.toISOString() }, days).startDate;
  return rows.filter((row) => {
    const parsed = parseDateText(row?.[dateKey]);
    if (!parsed) return false;
    return parsed >= cutoff && parsed <= endDate;
  });
}

function filterByWindowMonth(rows, monthKey, days, referenceDate) {
  const endDate = referenceDate instanceof Date ? referenceDate : getDashboardReferenceDate({ generatedAt: referenceDate });
  const cutoff = getWindowDateRange({ generatedAt: endDate.toISOString() }, days).startDate;
  return rows.filter((row) => {
    const parsed = parseMonthToDate(row?.[monthKey]);
    if (!parsed) return false;
    return parsed >= cutoff && parsed <= endDate;
  });
}

function normalizeFoodRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    occurrence_count: parseNumeric(row.occurrence_count) || 0,
    distinct_days: parseNumeric(row.distinct_days) || 0,
    total_quantity: parseNumeric(row.total_quantity) || 0,
    total_energy_kcal: parseNumeric(row.total_energy_kcal) || 0,
  }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mealScoreTone(score) {
  const numeric = Number(score);
  if (Number.isNaN(numeric)) return "neutral";
  if (numeric >= 80) return "score-strong";
  if (numeric >= 65) return "score-medium";
  return "score-low";
}

function foodCategoryTone(categoryKey) {
  const tones = {
    starch: "starch",
    vegetable: "vegetable",
    protein: "protein",
    dairy: "dairy",
    fruit: "fruit",
    drink: "drink",
    fat: "fat",
    mixed_dish: "mixed-dish",
  };
  return tones[categoryKey] || "neutral";
}

function foodCategoryColor(categoryKey) {
  const colors = {
    starch: "var(--category-starch)",
    vegetable: "var(--category-vegetable)",
    protein: "var(--category-protein)",
    dairy: "var(--category-dairy)",
    fruit: "var(--category-fruit)",
    drink: "var(--category-drink)",
    fat: "var(--category-fat)",
    mixed_dish: "var(--category-mixed-dish)",
  };
  return colors[categoryKey] || "var(--category-neutral)";
}

function foodCategoryFromKey(categoryKey) {
  const text = String(categoryKey || "");
  return text.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function foodCategoryChips(categoryKeys, categoryLabels, maxVisible = 3, categoryAllocations = []) {
  const keys = Array.isArray(categoryKeys) ? categoryKeys.filter(Boolean) : [];
  const labels = Array.isArray(categoryLabels) ? categoryLabels : [];
  const allocations = Array.isArray(categoryAllocations) ? categoryAllocations : [];

  const allocationByKey = new Map();
  if (Array.isArray(allocations)) {
    allocations.forEach((allocation) => {
      if (!allocation || !allocation.key) return;
      allocationByKey.set(allocation.key, allocation);
    });
  }
  const allocationByLabel = new Map();
  if (Array.isArray(allocations)) {
    allocations.forEach((allocation) => {
      if (!allocation || !allocation.label) return;
      allocationByLabel.set(allocation.label, allocation);
    });
  }
  const entries = keys.map((key, index) => {
    const label = labels[index] || foodCategoryFromKey(key);
    const allocation = allocationByKey.get(key) || allocationByLabel.get(label) || {};
    return {
      key,
      label,
      percent: Number(allocation.sharePercent),
    };
  });
  if (!entries.length) return "";

  const formatPercent = (value) => Number.isFinite(value) ? `${Number.isInteger(value) ? value : Number(value).toFixed(1)} %` : "";
  const visibleEntries = entries.slice(0, maxVisible);
  const hiddenEntries = entries.slice(maxVisible);
  if (!keys.length) return "";
  const visible = visibleEntries.map((entry) => {
    const tone = foodCategoryTone(entry.key);
    const percent = formatPercent(entry.percent);
    const title = percent ? `${entry.label} · ${percent}` : entry.label;
    return `<span class="food-category-chip" data-tone="${escapeHtml(tone)}" title="${escapeHtml(title)}">${escapeHtml(entry.label)}</span>`;
  }).join("");
  const summary = hiddenEntries.length
    ? `<span class="food-category-chip chip-more" title="${escapeHtml(
      `+${hiddenEntries.length}: ` + hiddenEntries.map((entry) => `${entry.label}${formatPercent(entry.percent) ? ` · ${formatPercent(entry.percent)}` : ""}`).join(", ")
    )}">${escapeHtml(`+${hiddenEntries.length}`)}</span>`
    : "";
  return `${visible}${summary}`;
}

function renderFreshness(data) {
  const target = document.getElementById("dashboard-freshness");
  if (!target) return;
  const generatedAt = data?.generatedAt;
  if (!generatedAt) {
    target.textContent = "Dernière mise à jour indisponible";
    return;
  }
  const parsed = new Date(generatedAt);
  const formatted = Number.isNaN(parsed.valueOf())
    ? generatedAt
    : FRESHNESS_FORMATTER.format(parsed);
  target.textContent = `Dernière mise à jour: ${formatted}`;
}

function renderFreshnessError(message) {
  const target = document.getElementById("dashboard-freshness");
  if (!target) return;
  target.textContent = message;
}

function renderSignals(data) {
  const container = document.getElementById("signal-list");
  container.innerHTML = "";
  data.signals.forEach((signal) => {
    const item = document.createElement("span");
    item.className = "signal-pill";
    item.dataset.tone = signal.tone || "info";
    item.textContent = signal.title;
    container.appendChild(item);
  });
}

function nutritionStatusLabel(status) {
  const labels = {
    good: "Bon repère",
    watch: "À surveiller",
    low: "Sous le repère",
  };
  return labels[status] || "Repère";
}

function formatScopeCoverage(scope) {
  const mealsLabel = scope.mealsCount > 1 ? "repas" : "repas";
  const daysLabel = scope.daysCovered > 1 ? "jours couverts" : "jour couvert";
  return `${scope.mealsCount} ${mealsLabel} • ${scope.daysCovered} ${daysLabel}`;
}

function buildNutritionDonut(shares, totalKcal, scopeLabel) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = shares.map((entry) => {
    const length = (entry.sharePct / 100) * circumference;
    const segment = `
      <circle
        cx="80"
        cy="80"
        r="${radius}"
        fill="none"
        stroke="${foodCategoryColor(entry.key)}"
        stroke-width="18"
        stroke-dasharray="${length} ${Math.max(circumference - length, 0)}"
        stroke-dashoffset="${-offset}"
      ></circle>
    `;
    offset += length;
    return segment;
  }).join("");

  return `
    <svg viewBox="0 0 160 160" class="nutrition-donut-svg" role="img" aria-label="Répartition calorique estimée pour ${escapeHtml(scopeLabel)}">
      <g transform="rotate(-90 80 80)">
        <circle cx="80" cy="80" r="${radius}" fill="none" stroke="rgba(28, 36, 31, 0.08)" stroke-width="18"></circle>
        ${segments}
      </g>
      <circle cx="80" cy="80" r="42" fill="rgba(255, 252, 244, 0.96)"></circle>
      <text x="80" y="74" text-anchor="middle" class="nutrition-donut-value">${Math.round(totalKcal || 0)}</text>
      <text x="80" y="92" text-anchor="middle" class="nutrition-donut-unit">kcal</text>
      <text x="80" y="110" text-anchor="middle" class="nutrition-donut-label">${escapeHtml(scopeLabel)}</text>
    </svg>
  `;
}

function renderNutritionBalance(data) {
  const target = document.getElementById("nutrition-balance");
  if (!target) return;

  const balance = data.nutritionBalance || {};
  const windows = balance.windows || {};
  const defaultWindow = String(
    Number(state.nutritionWindowDays) || balance.defaultWindowDays || 30
  );
  const windowKeys = Object.keys(windows);
  const activeWindow = windows[defaultWindow]
    ? String(defaultWindow)
    : (windowKeys.length ? windowKeys[0] : String(balance.windowDays || defaultWindow));
  const scopedBalance = windows[activeWindow] || balance;
  const scopes = scopedBalance.scopes || {};
  const scopeKey = scopes[state.nutritionScope] ? state.nutritionScope : "all";
  const scope = scopes[scopeKey];

  if (!scope) {
    target.innerHTML = "";
    return;
  }

  const scopeOrder = ["all", "breakfast", "lunch", "dinner"].filter((key) => scopes[key]);
  const tabs = scopeOrder.map((key) => `
    <button class="nutrition-scope-tab${key === scopeKey ? " is-active" : ""}" data-scope="${escapeHtml(key)}" type="button">
      ${escapeHtml(scopes[key].label)}
    </button>
  `).join("");

  const windowLabel = `${activeWindow} derniers jours`;

  const comparisonCards = (scope.whoComparison || []).map((item) => {
    const currentValue = parseNumeric(item.currentValue);
    const targetValue = parseNumeric(item.targetValue);
    const unit = String(item.unit || "");
    const delta = parseNumeric(item.delta);
    const progress = parseNumeric(item.progressPct);
    const progressPct = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 100)) : 0;
    const current = currentValue === null ? "—" : `${Math.round(currentValue)}${unit ? ` ${unit}` : ""}`;
    const target = targetValue === null ? "—" : `${Math.round(targetValue)}${unit ? ` ${unit}` : ""}`;
    const deltaLabel = delta === null ? "" : `(${delta >= 0 ? "+" : ""}${delta}${unit ? ` ${unit}` : ""} vs cible)`;

    return `
      <article class="nutrition-compare-card" data-status="${escapeHtml(item.status || "watch")}" title="${escapeHtml(item.calculationDetails || item.calculationReport || "")}">
        <div class="nutrition-compare-top">
          <strong>${escapeHtml(item.label || "Repère")}</strong>
          <span class="nutrition-compare-status">${escapeHtml(nutritionStatusLabel(item.status))}</span>
        </div>
        <p>${escapeHtml(item.shortMessage || "")}</p>
        <span class="nutrition-compare-target">${escapeHtml(item.recommendedTarget || "")}</span>
        <div class="nutrition-compare-progress">
          <span class="nutrition-compare-progress-values">${escapeHtml(current)} ${escapeHtml(`sur ${target}`)} ${escapeHtml(deltaLabel)}</span>
          <div class="nutrition-compare-progress-track" role="img" aria-label="Comparatif pour ${escapeHtml(item.label || "repère")}">
            <span class="nutrition-compare-progress-fill" style="width:${escapeHtml(progressPct.toFixed(1))}%;"></span>
          </div>
        </div>
      </article>
    `;
  }).join("");

  if (!scope.categoryShares.length || !scope.totalKcal) {
    target.innerHTML = `
      <article class="nutrition-balance-card">
        <div class="nutrition-balance-head">
          <div>
            <p class="panel-kicker">Répartition nutritionnelle récente</p>
            <h3 class="title-with-icon small"><span class="title-icon" aria-hidden="true">🥗</span><span>${escapeHtml(windowLabel)}</span></h3>
            <p>Lecture calorique par catégorie et repères inspirés OMS.</p>
          </div>
          <div class="nutrition-scope-tabs">${tabs}</div>
        </div>
        <div class="empty-state">Aucune donnée exploitable pour cette vue sur cette fenêtre.</div>
      </article>
    `;
  } else {
    const formatGrams = (value) => {
      const number = parseNumeric(value);
      if (number === null) return "";
      if (number === 0) return "";
      return `${Math.round(number)} g`;
    };
    const legend = scope.categoryShares.map((entry) => {
      const grams = formatGrams(entry.grams);
      const details = grams ? ` • ${escapeHtml(grams)}` : "";
      return `
      <li class="nutrition-legend-item">
        <span class="nutrition-legend-main">
          <span class="nutrition-legend-swatch" style="background:${foodCategoryColor(entry.key)};"></span>
          <span class="nutrition-legend-label">${escapeHtml(entry.icon || "🍽️")} ${escapeHtml(entry.label || entry.key)}</span>
        </span>
        <span class="nutrition-legend-values">${escapeHtml(String(entry.sharePct))}% • ${escapeHtml(String(Math.round(entry.kcal)))} kcal${details}</span>
      </li>
    `;}).join("");

    target.innerHTML = `
      <article class="nutrition-balance-card">
        <div class="nutrition-balance-head">
          <div>
            <p class="panel-kicker">Répartition nutritionnelle récente</p>
            <h3 class="title-with-icon small"><span class="title-icon" aria-hidden="true">🥗</span><span>${escapeHtml(windowLabel)}</span></h3>
            <p>Lecture calorique par catégorie et repères inspirés OMS, sans prétention de conformité réglementaire.</p>
          </div>
          <div class="nutrition-scope-tabs">${tabs}</div>
        </div>

        <div class="nutrition-balance-meta">
          <span>${escapeHtml(formatScopeCoverage(scope))}</span>
          <span>${escapeHtml(Math.round(scope.totalKcal))} kcal estimées</span>
        </div>

        ${scope.insufficientData ? `<div class="nutrition-balance-warning">${escapeHtml(scope.insufficientDataMessage || "Lecture encore fragile.")}</div>` : ""}

        <div class="nutrition-balance-grid">
          <div class="nutrition-balance-viz">
            <div class="nutrition-donut-wrap">
              ${buildNutritionDonut(scope.categoryShares, scope.totalKcal, scope.label)}
            </div>
            <ul class="nutrition-legend-list">
              ${legend}
            </ul>
          </div>

          <div class="nutrition-balance-insights">
            <div class="nutrition-insights-head">
              <strong>Repères inspirés OMS</strong>
              <span>Lecture pratique sur la fenêtre sélectionnée</span>
            </div>
            <div class="nutrition-compare-grid">
              ${comparisonCards}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  target.querySelectorAll(".nutrition-scope-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.nutritionScope = button.dataset.scope || "all";
      renderNutritionBalance(data);
    });
  });
}

function estimateMealDensityStats(meal) {
  const assessment = meal?.assessment || {};
  const estimatedEnergy = parseNumeric(assessment.estimatedEnergyKcal);
  const items = Array.isArray(meal?.items) ? meal.items : [];
  if (estimatedEnergy === null) return "";
  const totalWeight = items.reduce((total, item) => {
    const text = item?.quantityText || item?.portionText || "";
    const match = String(text).match(/(-?\d+(?:[.,]\d+)?)\s*(g|grammes?|ml|cl|l|L|verre|piece|pièces?|tranche)/i);
    if (!match) return total;
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return total;
    const unit = (match[2] || "").toLowerCase();
    if (unit.includes("g") && !unit.includes("ml") && !unit.includes("cl")) {
      return total + amount;
    }
    return total;
  }, 0);
  const itemCount = items.length || 1;
  const byWeight = totalWeight > 0 ? Math.round(estimatedEnergy / (totalWeight / 100)) : null;
  const byItem = Math.round(estimatedEnergy / itemCount);
  const perItemLabel = `${byItem} kcal / élément`;
  const per100gLabel = byWeight === null ? "" : `${byWeight} kcal/100g`;
  return byWeight === null ? perItemLabel : `${per100gLabel} • ${perItemLabel}`;
}

function buildMealCardsForDateGroup(meals, data) {
  return meals.map((meal) => {
    const article = document.createElement("article");
    article.className = "meal-card";
    const estimatedCount = (meal.items || []).filter((item) => item.quantitySource === "estimated").length;
    const assessment = meal.assessment || {};
    const recommendations = (assessment.recommendations || []).filter(Boolean);
    const hasAssessment = assessment.estimatedEnergyKcal || assessment.qualityScore || recommendations.length;
    const hasEstimatedEnergy = parseNumeric(assessment.estimatedEnergyKcal) !== null;
    const hasScore = assessment.qualityScore !== null && assessment.qualityScore !== undefined && assessment.qualityScore !== "";
    const badgeTone = hasScore ? mealScoreTone(assessment.qualityScore) : (estimatedCount ? "estimated" : "exact");
    const badgeLabel = hasEstimatedEnergy ? "Estimation kcal" : (estimatedCount ? `${estimatedCount} estimés` : "Structure");
    const density = estimateMealDensityStats(meal);
    article.innerHTML = `
      <div class="meal-card-head">
        <div>
          <div class="meal-card-kicker">${escapeHtml(meal.mealTypeIcon || "🍽️")} ${escapeHtml(meal.date || "Date inconnue")}</div>
          <h3>${escapeHtml(meal.mealTypeLabel || prettyLabel(meal.mealType) || "Repas")}</h3>
          <div class="meal-meta">
            <span>${escapeHtml(meal.time || "Heure non précisée")}</span>
            <span>${escapeHtml(prettyLabel(meal.captureMethod || "manual"))}</span>
          </div>
        </div>
        <div class="meal-badge" data-tone="${badgeTone}">
          ${escapeHtml(badgeLabel)}
        </div>
      </div>
      <p class="meal-source">${escapeHtml(meal.sourceText || meal.notes || "Aucune description disponible.")}</p>
      ${hasAssessment ? `
        <div class="meal-assessment">
          <div class="meal-assessment-stats">
            ${assessment.estimatedEnergyKcal ? `
              <div class="meal-stat">
                <span class="meal-stat-label">Estimation</span>
                <strong>${escapeHtml(String(assessment.estimatedEnergyKcal))} kcal</strong>
              </div>
            ` : ""}
            ${density ? `
              <div class="meal-stat">
                <span class="meal-stat-label">Densité</span>
                <strong>${escapeHtml(density)}</strong>
              </div>
            ` : ""}
          </div>
          ${recommendations.length ? `
            <div class="meal-recommendations">
              ${recommendations.map((recommendation) => `
                <span class="meal-recommendation">${escapeHtml(recommendation)}</span>
              `).join("")}
            </div>
          ` : ""}
        </div>
      ` : ""}
      <div class="meal-item-list">
        ${(meal.items || []).map((item) => `
          <div class="meal-item">
            <div class="meal-item-icon">${escapeHtml(item.icon || "🍽️")}</div>
            <div>
              <div class="meal-item-top">
                <strong>${escapeHtml(item.label || "Élément inconnu")}</strong>
                <span class="food-portion">${escapeHtml(item.quantityText || item.portionText || "")}</span>
              </div>
              <div class="food-meta">
                ${item.portionText && item.quantityText ? `<span>${escapeHtml(item.portionText)}</span>` : ""}
                ${(item.categoryKeys || item.categoryKey) ? foodCategoryChips(
                  item.categoryKeys || (item.categoryKey ? [item.categoryKey] : []),
                  item.categoryLabels || (item.categoryLabel ? [item.categoryLabel] : []),
                  2,
                  item.categoryAllocations || [],
                ) : ""}
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    return article;
  });
}

function groupMealsByDate(meals) {
  const groups = new Map();
  meals.forEach((meal) => {
    const key = meal.date || "Date inconnue";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(meal);
  });
  return [...groups.entries()].sort((a, b) => {
    const dateA = parseDateText(a[0]) || new Date(0);
    const dateB = parseDateText(b[0]) || new Date(0);
    return dateB - dateA || b[0].localeCompare(a[0]);
  });
}

function renderRecentMeals(data) {
  const container = document.getElementById("recent-meals");
  const pagination = document.getElementById("recent-meals-pagination");
  const windowDays = Number(state.nutritionWindowDays) || 30;
  const mealTypeFilter = state.mealTypeFilter || "all";
  const range = getWindowDateRange(data, windowDays);
  const meals = filterByWindowDate(data.recentMeals || [], "date", windowDays, range.endDate)
    .filter((meal) => meal && meal.date)
    .filter((meal) => mealTypeFilter === "all" || meal.mealType === mealTypeFilter)
    .sort((a, b) => parseDateText(b.date) - parseDateText(a.date));
  container.innerHTML = "";
  if (pagination) pagination.innerHTML = "";
  if (!meals.length) {
    container.innerHTML = `<div class="empty-state">Aucun repas saisi pour le moment. Les prochains repas apparaîtront ici en premier.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(meals.length / MEALS_PER_PAGE));
  state.mealsPage = Math.min(Math.max(state.mealsPage, 1), totalPages);
  const startIndex = (state.mealsPage - 1) * MEALS_PER_PAGE;
  const visibleMeals = meals.slice(startIndex, startIndex + MEALS_PER_PAGE);
  const groupedMeals = groupMealsByDate(visibleMeals);
  groupedMeals.forEach(([groupDate, groupMeals]) => {
    const section = document.createElement("section");
    section.className = "meal-day-group";
    section.innerHTML = `
      <div class="meal-day-header">
        <h4>${escapeHtml(formatShortDate(groupDate))}</h4>
        <span>${escapeHtml(String(groupMeals.length))} repas</span>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "meal-card-grid";
    buildMealCardsForDateGroup(groupMeals, data).forEach((mealNode) => {
      grid.appendChild(mealNode);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });

  if (pagination && totalPages > 1) {
    const firstMeal = startIndex + 1;
    const lastMeal = Math.min(startIndex + visibleMeals.length, meals.length);
    pagination.innerHTML = `
      <div class="meal-pagination-summary">
        Repas ${escapeHtml(String(firstMeal))} à ${escapeHtml(String(lastMeal))} sur ${escapeHtml(String(meals.length))}
      </div>
      <div class="meal-pagination-actions">
        <button class="meal-pagination-button" type="button" data-action="prev" ${state.mealsPage === 1 ? "disabled" : ""}>
          Précédent
        </button>
        <span class="meal-pagination-page">Page ${escapeHtml(String(state.mealsPage))}/${escapeHtml(String(totalPages))}</span>
        <button class="meal-pagination-button" type="button" data-action="next" ${state.mealsPage === totalPages ? "disabled" : ""}>
          Suivant
        </button>
      </div>
    `;

    pagination.querySelectorAll(".meal-pagination-button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.action === "prev" && state.mealsPage > 1) {
          state.mealsPage -= 1;
        }
        if (button.dataset.action === "next" && state.mealsPage < totalPages) {
          state.mealsPage += 1;
        }
        renderRecentMeals(data);
      });
    });
  }
}

function sectionBody(lines) {
  return lines
    .filter((line) => line.trim())
    .slice(0, 7)
    .map((line) => `<p>${escapeHtml(line.replace(/^- /, ""))}</p>`)
    .join("");
}

function prettyLabel(value) {
  const translated = {
    breakfast: "Petit déjeuner",
    lunch: "Déjeuner",
    dinner: "Dîner",
    snack: "Collation",
    exact: "Exact",
    estimated: "Estimé",
    unknown: "Inconnu",
    manual: "Manuel",
    realtime: "Temps Réel",
    same_day_recall: "Rappel Même Jour",
    historical_recall: "Rappel Historique",
    import: "Import",
    photo_share: "Photo Partagée",
    high: "Élevée",
    medium: "Moyenne",
    low: "Faible",
    normal: "Normal",
    info: "Info",
    active: "Actif",
    resolved: "Résolue",
    diagnosis: "Diagnostic",
    note: "Note",
    appointment: "Consultation",
    tracked: "Suivi",
    event: "Événement",
  };
  const raw = String(value || "");
  return translated[raw] || raw.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDelta(value) {
  if (value === null || value === undefined || value === "") return "Un seul point";
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric === 0) return "Stable vs précédent";
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric}`;
}

function getFoodSortValue(row, sortMode) {
  const values = {
    occurrence: parseNumeric(row.occurrence_count),
    kcal: parseNumeric(row.total_energy_kcal),
    quantity: parseNumeric(row.total_quantity),
    days: parseNumeric(row.distinct_days),
  };
  return values[sortMode] ?? "";
}

function sortFoodRows(rows, sortMode, direction = "desc") {
  const directionFactor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const first = getFoodSortValue(a, sortMode);
    const second = getFoodSortValue(b, sortMode);
    if (typeof first === "number" && typeof second === "number") {
      if (first === second) return 0;
      return (first - second) * directionFactor;
    }
    if (typeof first === "string" && typeof second === "string") {
      return first.localeCompare(second) * directionFactor;
    }
    if (first === null || first === undefined || first === "") return 1;
    if (second === null || second === undefined || second === "") return -1;
    return 0;
  });
}

function buildFoodWindowRows(data) {
  const windowDays = Number(state.nutritionWindowDays) || 30;
  const range = getWindowDateRange(data, windowDays);
  return filterByWindowMonth(data.foodFrequency || [], "month", windowDays, range.endDate);
}

function deltaTone(value) {
  if (value === null || value === undefined || value === "") return "is-flat";
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric === 0) return "is-flat";
  return numeric > 0 ? "is-up" : "is-down";
}

function buildSparkline(series) {
  if (!series.length) return "";
  const points = series
    .map((entry) => ({ date: entry.date, numeric: parseNumeric(entry.value), status: entry.status }))
    .filter((entry) => entry.numeric !== null);
  if (!points.length) return `<div class="empty-state">Pas assez de valeurs numériques.</div>`;

  const width = 220;
  const height = 46;
  const paddingX = 6;
  const paddingY = 7;
  const min = Math.min(...points.map((point) => point.numeric));
  const max = Math.max(...points.map((point) => point.numeric));
  const span = max - min || 1;
  const xStep = points.length > 1 ? (width - paddingX * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    ...point,
    x: paddingX + index * xStep,
    y: height - paddingY - ((point.numeric - min) / span) * (height - paddingY * 2),
  }));
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return `
    <div class="sparkline" aria-hidden="true">
      <svg viewBox="0 0 ${width} ${height}">
        <path d="${path}" fill="none" stroke="#234b44" stroke-width="2.5" stroke-linecap="round"></path>
        ${coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.2" fill="#6d8f3a"></circle>`).join("")}
      </svg>
    </div>
  `;
}

function renderReferenceSections(data) {
  const container = document.getElementById("reference-sections");
  const template = document.getElementById("reference-template");
  const preferredOrder = [
    { title: "Identité et situation actuelle", keys: ["Identité et situation actuelle", "Identity And Current Snapshot"] },
    { title: "Conditions actives et diagnostics", keys: ["Conditions actives et diagnostics", "Active Conditions And Diagnoses"] },
    { title: "Allergies et intolérances", keys: ["Allergies et intolérances", "Allergies And Intolerances"] },
    { title: "Profil alimentaire", keys: ["Profil alimentaire", "Dietary Pattern"] },
    { title: "Digestion", keys: ["Digestion"] },
    { title: "Hydratation et sommeil", keys: ["Hydratation et sommeil", "Hydration And Sleep"] },
    { title: "Objectifs", keys: ["Objectifs", "Goals"] },
  ];
  container.innerHTML = "";
  preferredOrder.forEach((section) => {
    const sectionKey = section.keys.find((key) => data.referenceSections?.[key]);
    const lines = sectionKey ? data.referenceSections?.[sectionKey] : null;
    if (!lines) return;
    const fragment = template.content.cloneNode(true);
    fragment.querySelector("h3").textContent = section.title;
    fragment.querySelector(".summary-lines").innerHTML = sectionBody(lines);
    container.appendChild(fragment);
  });
}

function renderLabs(data) {
  document.getElementById("lab-intro").textContent = data.latestLabDate
    ? `Dernier bilan structuré: ${data.latestLabDate}.`
    : "Aucun bilan structuré disponible pour le moment.";
  const grid = document.getElementById("lab-grid");
  grid.innerHTML = "";
  if (!data.latestLabCards.length) {
    grid.innerHTML = `<div class="empty-state">Aucun marqueur clé disponible pour le moment.</div>`;
    return;
  }
  data.latestLabCards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "lab-card";
    article.dataset.status = card.status;
    article.innerHTML = `
      <strong>${escapeHtml(card.label)}</strong>
      <div class="lab-value">${escapeHtml(String(card.value))}</div>
      <div class="lab-unit">${escapeHtml(card.unit || "")}</div>
      <p>${escapeHtml(card.note || "")}</p>
    `;
    grid.appendChild(article);
  });
}

function renderDigestiveFocus(data) {
  const focus = data.digestiveFocus || {};
  document.getElementById("digestive-summary").textContent =
    focus.summary || "Aucun résumé digestif disponible pour le moment.";
  document.getElementById("digestive-management").textContent =
    focus.management || focus.lactoseNote || "Aucune note de gestion disponible pour le moment.";

  const triggerList = document.getElementById("digestive-trigger-list");
  triggerList.innerHTML = "";
  const triggers = [...(focus.triggers || [])];
  if (focus.lactoseNote) triggers.push("Sensibilité au lactose documentée");
  if (!triggers.length) {
    triggerList.innerHTML = `<div class="empty-state">Aucun déclencheur digestif structuré pour le moment.</div>`;
  } else {
    triggers.forEach((trigger) => {
      const chip = document.createElement("span");
      chip.className = "focus-chip";
      chip.textContent = trigger;
      triggerList.appendChild(chip);
    });
  }

  const conditions = document.getElementById("digestive-conditions");
  conditions.innerHTML = "";
  if (!(focus.conditions || []).length) {
    conditions.innerHTML = `<div class="empty-state">Aucune condition digestive concernée pour le moment.</div>`;
  } else {
    focus.conditions.forEach((condition) => {
      const item = document.createElement("article");
      item.className = "stack-item";
      item.innerHTML = `
        <div class="stack-meta"><span>${escapeHtml(prettyLabel(condition.status || "tracked"))}</span></div>
        <h4>${escapeHtml(condition.label || "Condition sans nom")}</h4>
        <p>${escapeHtml(condition.notes || "Aucune note complémentaire.")}</p>
      `;
      conditions.appendChild(item);
    });
  }

  const events = document.getElementById("digestive-events");
  events.innerHTML = "";
  if (!(focus.events || []).length) {
    events.innerHTML = `<div class="empty-state">Aucun point de repère digestif disponible pour le moment.</div>`;
  } else {
    focus.events.forEach((event) => {
      const item = document.createElement("article");
      item.className = "stack-item";
      item.innerHTML = `
        <div class="stack-meta">
          <span>${escapeHtml(event.date || "Date inconnue")}</span>
          <span>${escapeHtml(prettyLabel(event.type || "event"))}</span>
        </div>
        <h4>${escapeHtml(event.title || "Événement sans titre")}</h4>
        <p>${escapeHtml(event.notes || "Aucune note enregistrée.")}</p>
      `;
      events.appendChild(item);
    });
  }

  const labs = document.getElementById("digestive-labs");
  labs.innerHTML = "";
  if (!(focus.labs || []).length) {
    labs.innerHTML = `<div class="empty-state">Aucun bilan digestif utile structuré pour le moment.</div>`;
  } else {
    focus.labs.forEach((lab) => {
      const item = document.createElement("article");
      item.className = "mini-lab-card";
      item.dataset.status = lab.status || "info";
      item.innerHTML = `
        <strong>${escapeHtml(lab.label || "Marqueur inconnu")}</strong>
        <div class="mini-lab-value">${escapeHtml(String(lab.value || "—"))}</div>
        <div class="mini-lab-meta">
          <span>${escapeHtml(lab.unit || "sans unité")}</span>
          <span>${escapeHtml(lab.date || "sans date")}</span>
        </div>
        <p>${escapeHtml(lab.note || "")}</p>
      `;
      labs.appendChild(item);
    });
  }
}

function renderLabHistory(data) {
  const target = document.getElementById("lab-history-grid");
  const history = data.labHistory || [];
  target.innerHTML = "";
  if (!history.length) {
    target.innerHTML = `<div class="empty-state">Aucun marqueur récurrent disponible pour le moment.</div>`;
    return;
  }
  history.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "lab-history-card";
    article.dataset.status = entry.latestStatus || "info";
    article.innerHTML = `
      <div class="lab-history-top">
        <div>
          <h4>${escapeHtml(entry.label || "Marqueur inconnu")}</h4>
          <div class="lab-history-meta">
            <span>${escapeHtml(entry.latestDate || "Date inconnue")}</span>
            <span>${escapeHtml(prettyLabel(entry.latestStatus || "info"))}</span>
          </div>
        </div>
        <div class="lab-history-delta ${deltaTone(entry.delta)}">${escapeHtml(formatDelta(entry.delta))}</div>
      </div>
      <div class="lab-history-value">${escapeHtml(String(entry.latestValue || "—"))}</div>
      <div class="lab-history-unit">${escapeHtml(entry.unit || "")}</div>
      ${buildSparkline(entry.series || [])}
      <p>${escapeHtml(entry.previousDate ? `Précédent: ${entry.previousValue} le ${entry.previousDate}` : "Un seul point connu pour le moment.")}</p>
    `;
    target.appendChild(article);
  });
}

function renderWeightChart(data) {
  const target = document.getElementById("weight-chart");
  const points = data.weightHistory || [];
  if (!points.length) {
    target.innerHTML = `<div class="empty-state">Aucun historique de poids disponible pour le moment.</div>`;
    return;
  }
  const width = 560;
  const height = 240;
  const padding = 24;
  const numeric = points.map((point) => Number(point.weightKg));
  const min = Math.min(...numeric) - 1;
  const max = Math.max(...numeric) + 1;
  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => {
    const x = padding + xStep * index;
    const y = height - padding - ((Number(point.weightKg) - min) / (max - min || 1)) * (height - padding * 2);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Évolution du poids">
      <defs>
        <linearGradient id="weight-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stop-color="#6d8f3a"></stop>
          <stop offset="100%" stop-color="#234b44"></stop>
        </linearGradient>
      </defs>
      <path d="${path}" fill="none" stroke="url(#weight-gradient)" stroke-width="4" stroke-linecap="round"></path>
      ${coords.map((point) => `
        <circle cx="${point.x}" cy="${point.y}" r="5.5" fill="#fffdf5" stroke="#234b44" stroke-width="2"></circle>
        <text x="${point.x}" y="${point.y - 12}" text-anchor="middle" font-size="12" fill="#1c241f">${point.weightKg} kg</text>
        <text x="${point.x}" y="${height - 6}" text-anchor="middle" font-size="11" fill="#56635c">${point.date}</text>
      `).join("")}
    </svg>
  `;
}

function renderMonthlyBars(data) {
  const target = document.getElementById("monthly-bars");
  const months = data.monthlySummaries || [];
  if (!months.length) {
    target.innerHTML = `<div class="empty-state">Aucun résumé mensuel disponible pour le moment.</div>`;
    return;
  }
  const maxMeals = Math.max(...months.map((month) => Number(month.meals_logged || 0)), 1);
  target.innerHTML = `
    <div style="display:grid; gap: 12px;">
      ${months.map((month) => {
        const meals = Number(month.meals_logged || 0);
        const coverage = Number(month.nutrition_coverage_ratio_avg || 0);
        const width = Math.max((meals / maxMeals) * 100, 3);
        return `
          <div>
            <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:6px;">
              <strong style="font-size:0.95rem;">${month.month}</strong>
              <span style="font-family:var(--mono); color:var(--muted); font-size:0.82rem;">${meals} repas • ${(coverage * 100).toFixed(0)}% couverture</span>
            </div>
            <div style="height:12px; background:rgba(28,36,31,0.08); border-radius:999px; overflow:hidden;">
              <div style="height:100%; width:${width}%; background:linear-gradient(90deg, #7a2747, #6d8f3a); border-radius:999px;"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderTimeline(data) {
  const target = document.getElementById("timeline-list");
  target.innerHTML = "";
  (data.timeline || []).slice(0, 12).forEach((item) => {
    const article = document.createElement("article");
    article.className = "timeline-item";
    article.innerHTML = `
      <div class="timeline-meta">
        <span>${escapeHtml(item.date || "Date inconnue")}</span>
        <span>${escapeHtml(prettyLabel(item.type || "event"))}</span>
        <span>${escapeHtml(prettyLabel(item.status || "unknown"))}</span>
      </div>
      <h3>${escapeHtml(item.title || "Événement sans titre")}</h3>
      <p>${escapeHtml(item.notes || "")}</p>
      <div class="timeline-meta"><span>${escapeHtml(item.practitioner || "Aucun praticien renseigné")}</span></div>
    `;
    target.appendChild(article);
  });
}

function renderFoodTable(data) {
  const sortMode = state.foodSort || "occurrence";
  const body = document.getElementById("food-table-body");
  const pagination = document.getElementById("food-table-pagination");
  body.innerHTML = "";
  if (pagination) pagination.innerHTML = "";
  const foods = sortFoodRows(
    normalizeFoodRows(buildFoodWindowRows(data)),
    sortMode,
    state.foodSortDirection,
  );
  if (!foods.length) {
    body.innerHTML = `<tr><td colspan="7">Aucune fréquence alimentaire disponible pour le moment. Commence à saisir des repas pour remplir cette table.</td></tr>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(foods.length / FOODS_PER_PAGE));
  state.foodsPage = Math.min(Math.max(state.foodsPage, 1), totalPages);
  const startIndex = (state.foodsPage - 1) * FOODS_PER_PAGE;
  const visibleFoods = foods.slice(startIndex, startIndex + FOODS_PER_PAGE);

  visibleFoods.forEach((row) => {
    const categoryKeys = row.categoryKeys || row.category_keys || (row.category_key ? [row.category_key] : []);
    const categoryLabels = row.categoryLabels || row.category_labels || (row.category_label ? [row.category_label] : []);
    const categoryAllocations = row.categoryAllocations || [];
    const icon = row.icon || "🍽️";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="food-name-cell"><span class="food-name-icon">${escapeHtml(icon)}</span><span>${escapeHtml(row.label || row.food_key || "Inconnu")}</span></span></td>
      <td>${categoryKeys.length ? foodCategoryChips(categoryKeys, categoryLabels, 3, categoryAllocations) : "—"}</td>
      <td>${escapeHtml(String(row.occurrence_count || ""))}</td>
      <td>${escapeHtml(String(row.distinct_days || ""))}</td>
      <td>${escapeHtml(row.total_quantity ? `${row.total_quantity} ${row.unit || ""}` : "—")}</td>
      <td>${escapeHtml(row.total_energy_kcal ? `${row.total_energy_kcal} kcal` : "—")}</td>
      <td>${escapeHtml(row.portion_text_examples || "—")}</td>
    `;
    body.appendChild(tr);
  });

  if (pagination && totalPages > 1) {
    const firstFood = startIndex + 1;
    const lastFood = Math.min(startIndex + visibleFoods.length, foods.length);
    pagination.innerHTML = `
      <div class="section-pagination-summary">
        Aliments ${escapeHtml(String(firstFood))} à ${escapeHtml(String(lastFood))} sur ${escapeHtml(String(foods.length))}
      </div>
      <div class="section-pagination-actions">
        <button class="section-pagination-button" type="button" data-action="prev" ${state.foodsPage === 1 ? "disabled" : ""}>
          Précédent
        </button>
        <span class="section-pagination-page">Page ${escapeHtml(String(state.foodsPage))}/${escapeHtml(String(totalPages))}</span>
        <button class="section-pagination-button" type="button" data-action="next" ${state.foodsPage === totalPages ? "disabled" : ""}>
          Suivant
        </button>
      </div>
    `;

    pagination.querySelectorAll(".section-pagination-button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.action === "prev" && state.foodsPage > 1) {
          state.foodsPage -= 1;
        }
        if (button.dataset.action === "next" && state.foodsPage < totalPages) {
          state.foodsPage += 1;
        }
        renderFoodTable(data);
      });
    });
  }
}

function buildProfileQuickStatRows(data) {
  const summary = data.profileSummary || {};
  const weight = parseNumeric(summary.weightKg);
  const height = parseNumeric(summary.heightCm);
  const imc = (weight && height) ? (weight / Math.pow(height / 100, 2)) : null;

  return [
    {
      label: "Période dashboard",
      value: `${String(Number(state.nutritionWindowDays) || 30)}j`,
    },
    {
      label: "Poids",
      value: weight ? `${weight} kg` : "—",
    },
    {
      label: "Taille",
      value: height ? `${height} cm` : "—",
    },
    {
      label: "IMC",
      value: imc ? `${imc.toFixed(1)}` : "—",
    },
    {
      label: "Activité",
      value: prettyLabel(summary.activityLevel || "unknown"),
    },
    {
      label: "Sommeil",
      value: prettyLabel(summary.sleepQuality || "unknown"),
    },
  ];
}

function renderDailySteps(data) {
  const target = document.getElementById("steps-by-day");
  if (!target) return;

  const rows = (data && Array.isArray(data.stepsByDay) ? data.stepsByDay : [])
    .map((row) => ({
      date: String(row?.date || ""),
      steps: parseNumeric(row?.steps),
      source: String(row?.source || "").trim(),
    }))
    .filter((row) => row.date && row.steps !== null)
    .sort((a, b) => {
      const aDate = parseDateText(a.date);
      const bDate = parseDateText(b.date);
      if (!aDate || !bDate) return 0;
      return bDate.getTime() - aDate.getTime();
    });

  if (!rows.length) {
    target.innerHTML = `<div class="empty-state">Aucune donnée de pas disponible.</div>`;
    return;
  }

  target.innerHTML = rows
    .map((row) => {
      const dateLabel = formatShortDate(row.date);
      const steps = Number.isInteger(row.steps) ? `${row.steps} pas` : `${row.steps} pas`;
      const source = row.source === "seed" ? "initialisation" : row.source || "source inconnue";
      return `
        <article class="steps-entry">
          <div class="steps-entry-main">
            <span class="steps-entry-date">${escapeHtml(dateLabel)}</span>
            <span class="steps-entry-source">${escapeHtml(source)}</span>
          </div>
          <span class="steps-entry-count">${escapeHtml(steps)}</span>
        </article>
      `;
    })
    .join("");
}

function renderProfileQuickStats(data) {
  const target = document.getElementById("profile-quick-stats");
  if (!target) return;
  const rows = buildProfileQuickStatRows(data);
  target.innerHTML = rows
    .map((row) => `
      <article class="profile-quick-stat">
        <span class="quick-label">${escapeHtml(row.label)}</span>
        <span class="quick-value">${escapeHtml(String(row.value))}</span>
      </article>
    `)
    .join("");
  const profileWindowInfo = document.querySelector(".two-column .toolbar-info");
  if (profileWindowInfo) {
    profileWindowInfo.textContent =
      `Contexte filtré dynamiquement sur ${String(Number(state.nutritionWindowDays) || 30)} derniers jours`;
  }
}

function syncSectionControlsState() {
  const windowButtons = document.querySelectorAll('[data-control="window"] .toolbar-button[data-time-window]');
  const activeWindow = String(Number(state.nutritionWindowDays) || 30);
  windowButtons.forEach((button) => {
    const isActive = button.dataset.timeWindow === activeWindow;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  const sortButtons = document.querySelectorAll('[data-control="food-sort"] .toolbar-button[data-food-sort]');
  const activeSort = state.foodSort || "occurrence";
  sortButtons.forEach((button) => {
      const isActive = button.dataset.foodSort === activeSort;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  const sortDirectionButtons = document.querySelectorAll(
    '[data-control="food-sort-direction"] .toolbar-button[data-food-sort-direction]'
  );
  const activeSortDirection = state.foodSortDirection || "desc";
  sortDirectionButtons.forEach((button) => {
    const isActive = button.dataset.foodSortDirection === activeSortDirection;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  const mealTypeButtons = document.querySelectorAll('[data-control="meal-type"] .toolbar-button[data-meal-type]');
  const activeMealType = state.mealTypeFilter || "all";
  mealTypeButtons.forEach((button) => {
    const isActive = button.dataset.mealType === activeMealType;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function setupSectionControls() {
  if (setupSectionControls._initialized) return;
  setupSectionControls._initialized = true;

  document.querySelectorAll(".toolbar-button[data-time-window]").forEach((button) => {
    button.addEventListener("click", () => {
      const windowDays = Number(button.dataset.timeWindow);
      if (!windowDays) return;
      state.nutritionWindowDays = String(windowDays);
      state.mealsPage = 1;
      state.foodsPage = 1;
      syncSectionControlsState();
      if (!state.dashboard) return;
      renderFoodTable(state.dashboard);
      renderRecentMeals(state.dashboard);
      renderSignals(state.dashboard);
      renderNutritionBalance(state.dashboard);
      renderProfileQuickStats(state.dashboard);
    });
  });

  document.querySelectorAll(".toolbar-button[data-food-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const sortMode = button.dataset.foodSort;
      if (!sortMode) return;
      state.foodSort = sortMode;
      state.foodsPage = 1;
      syncSectionControlsState();
      if (!state.dashboard) return;
      renderFoodTable(state.dashboard);
    });
  });

  document.querySelectorAll('.toolbar-button[data-food-sort-direction]').forEach((button) => {
    button.addEventListener('click', () => {
      const sortDirection = button.dataset.foodSortDirection;
      if (!sortDirection) return;
      if (sortDirection === "asc" || sortDirection === "desc") {
        state.foodSortDirection = sortDirection;
      }
      state.foodsPage = 1;
      syncSectionControlsState();
      if (!state.dashboard) return;
      renderFoodTable(state.dashboard);
    });
  });

  document.querySelectorAll('.toolbar-button[data-meal-type]').forEach((button) => {
    button.addEventListener('click', () => {
      const mealType = button.dataset.mealType;
      if (!mealType) return;
      state.mealTypeFilter = mealType;
      state.mealsPage = 1;
      syncSectionControlsState();
      if (!state.dashboard) return;
      renderRecentMeals(state.dashboard);
    });
  });
}

function renderDocuments(data) {
  const target = document.getElementById("document-list");
  target.innerHTML = "";
  data.sourceDocuments.forEach((doc) => {
    const article = document.createElement("article");
    article.className = "document-item";
    article.innerHTML = `
      <div class="document-meta"><span>${escapeHtml(doc.category || "document")}</span></div>
      <h3>${escapeHtml(doc.name)}</h3>
      <p>${escapeHtml(doc.path)}</p>
    `;
    target.appendChild(article);
  });
}

function serializeSignature(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value ?? "") : serialized;
}

function buildRenderSignatures(data) {
  return {
    freshness: serializeSignature(data?.generatedAt || ""),
    foodTable: serializeSignature({
      windowDays: state.nutritionWindowDays,
      sort: state.foodSort,
      sortDirection: state.foodSortDirection,
      page: state.foodsPage,
      rows: data?.foodFrequency || [],
      recentMeals: data?.recentMeals || [],
      generatedAt: data?.generatedAt || "",
    }),
    dailySteps: serializeSignature(data?.stepsByDay || []),
    profileQuickStats: serializeSignature({
      windowDays: state.nutritionWindowDays,
      profileSummary: data?.profileSummary || {},
    }),
    signals: serializeSignature({
      windowDays: state.nutritionWindowDays,
      signals: data?.signals || [],
    }),
    nutritionBalance: serializeSignature({
      windowDays: state.nutritionWindowDays,
      scope: state.nutritionScope,
      balance: data?.nutritionBalance || {},
    }),
    recentMeals: serializeSignature({
      windowDays: state.nutritionWindowDays,
      mealType: state.mealTypeFilter,
      page: state.mealsPage,
      meals: data?.recentMeals || [],
      generatedAt: data?.generatedAt || "",
    }),
    referenceSections: serializeSignature(data?.referenceSections || {}),
    labs: serializeSignature({
      latestLabDate: data?.latestLabDate || "",
      latestLabCards: data?.latestLabCards || [],
    }),
    digestiveFocus: serializeSignature(data?.digestiveFocus || {}),
    labHistory: serializeSignature(data?.labHistory || []),
    weightChart: serializeSignature(data?.weightHistory || []),
    monthlyBars: serializeSignature(data?.monthlySummaries || []),
    timeline: serializeSignature(data?.timeline || []),
    documents: serializeSignature(data?.sourceDocuments || []),
  };
}

const SECTION_RENDERERS = {
  freshness: renderFreshness,
  foodTable: renderFoodTable,
  dailySteps: renderDailySteps,
  profileQuickStats: renderProfileQuickStats,
  signals: renderSignals,
  nutritionBalance: renderNutritionBalance,
  recentMeals: renderRecentMeals,
  referenceSections: renderReferenceSections,
  labs: renderLabs,
  digestiveFocus: renderDigestiveFocus,
  labHistory: renderLabHistory,
  weightChart: renderWeightChart,
  monthlyBars: renderMonthlyBars,
  timeline: renderTimeline,
  documents: renderDocuments,
};

function renderApp(data, { forceAll = false } = {}) {
  const nextSignatures = buildRenderSignatures(data);
  syncSectionControlsState();
  Object.entries(SECTION_RENDERERS).forEach(([key, renderSection]) => {
    if (!forceAll && state.renderSignatures[key] === nextSignatures[key]) {
      return;
    }
    renderSection(data);
    state.renderSignatures[key] = nextSignatures[key];
  });
}

function setupReveal() {
  const revealNodes = document.querySelectorAll(".reveal");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smallViewport = window.matchMedia("(max-width: 980px)").matches;
  const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  if (prefersReducedMotion || smallViewport || coarsePointer || !("IntersectionObserver" in window)) {
    document.body.dataset.reveal = "off";
    revealNodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  document.body.dataset.reveal = "on";
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  revealNodes.forEach((node) => observer.observe(node));
}

function setupLiveReload() {
  if (!["127.0.0.1", "localhost"].includes(window.location.hostname)) return;
  if (!("EventSource" in window)) return;
  try {
    const events = new EventSource("/__events");
    events.addEventListener("reload", () => {
      window.location.reload();
    });
  } catch (error) {
    console.debug("Live reload unavailable.", error);
  }
}

async function refreshDashboard({ force = false } = {}) {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    const nextDashboard = await loadDashboard();
    const currentGeneratedAt = state.dashboard?.generatedAt || "";
    const nextGeneratedAt = nextDashboard?.generatedAt || "";
    if (force || !state.dashboard || currentGeneratedAt !== nextGeneratedAt) {
      state.dashboard = nextDashboard;
      renderApp(state.dashboard, { forceAll: force || !currentGeneratedAt });
    }
  } catch (error) {
    if (error instanceof AuthRedirectError) {
      redirectToLogin(error.reason);
      return;
    }
    renderFreshnessError("Synchronisation interrompue. Recharge la session si besoin.");
    console.error("Dashboard refresh failed.", error);
  } finally {
    state.refreshInFlight = false;
  }
}

function setupFreshnessChecks() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }
  state.refreshTimer = window.setInterval(() => {
    refreshDashboard();
  }, REFRESH_INTERVAL_MS);

  window.addEventListener("focus", () => {
    refreshDashboard();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshDashboard();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      refreshDashboard({ force: true });
    }
  });
}

async function boot() {
  await waitForAuthBootstrap();
  state.dashboard = await loadDashboard();
  renderApp(state.dashboard, { forceAll: true });
  markAppHydrated();
  setupSectionControls();
  setupReveal();
  setupLiveReload();
  setupFreshnessChecks();
}

boot().catch((error) => {
  if (error instanceof AuthRedirectError) {
    redirectToLogin(error.reason);
    return;
  }
  document.body.innerHTML = `
    <main style="padding:32px; font-family: 'IBM Plex Mono', monospace;">
      <h1>Chargement du tableau de bord impossible</h1>
      <p>La session n'a pas pu charger les données attendues. Recharge la page ou reconnecte-toi.</p>
      <pre>${escapeHtml(error.message || "Erreur inconnue")}</pre>
    </main>
  `;
  console.error(error);
});
