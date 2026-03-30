const state = {
  dashboard: null,
  nutritionScope: "all",
  mealsPage: 1,
  foodsPage: 1,
  refreshTimer: null,
  refreshInFlight: false,
};

const REFRESH_INTERVAL_MS = 60000;
const MEALS_PER_PAGE = 3;
const FOODS_PER_PAGE = 10;

class AuthRedirectError extends Error {
  constructor(reason = "expired") {
    super("Session expirée ou accès protégé indisponible.");
    this.name = "AuthRedirectError";
    this.reason = reason;
  }
}

function redirectToLogin(reason = "expired") {
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

function prettyActivity(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
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

function foodCategoryChips(categoryKeys, categoryLabels) {
  const keys = Array.isArray(categoryKeys) ? categoryKeys.filter(Boolean) : [];
  const labels = Array.isArray(categoryLabels) ? categoryLabels : [];
  if (!keys.length) return "";
  return keys.map((key, index) => {
    const tone = foodCategoryTone(key);
    const label = labels[index] || foodCategoryFromKey(key);
    return `<span class="food-category-chip" data-tone="${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
  }).join("");
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
    : parsed.toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "medium",
    });
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
  const scopes = balance.scopes || {};
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

  const comparisonCards = (scope.whoComparison || []).map((item) => `
    <article class="nutrition-compare-card" data-status="${escapeHtml(item.status || "watch")}">
      <div class="nutrition-compare-top">
        <strong>${escapeHtml(item.label || "Repère")}</strong>
        <span class="nutrition-compare-status">${escapeHtml(nutritionStatusLabel(item.status))}</span>
      </div>
      <p>${escapeHtml(item.shortMessage || "")}</p>
      <span class="nutrition-compare-target">${escapeHtml(item.recommendedTarget || "")}</span>
    </article>
  `).join("");

  if (!scope.categoryShares.length || !scope.totalKcal) {
    target.innerHTML = `
      <article class="nutrition-balance-card">
        <div class="nutrition-balance-head">
          <div>
            <p class="panel-kicker">Répartition nutritionnelle récente</p>
            <h3 class="title-with-icon small"><span class="title-icon" aria-hidden="true">🥗</span><span>30 derniers jours</span></h3>
            <p>Lecture calorique par catégorie et repères inspirés OMS.</p>
          </div>
          <div class="nutrition-scope-tabs">${tabs}</div>
        </div>
        <div class="empty-state">Aucune donnée exploitable pour cette vue sur les 30 derniers jours.</div>
      </article>
    `;
  } else {
    const legend = scope.categoryShares.map((entry) => `
      <li class="nutrition-legend-item">
        <span class="nutrition-legend-main">
          <span class="nutrition-legend-swatch" style="background:${foodCategoryColor(entry.key)};"></span>
          <span class="nutrition-legend-label">${escapeHtml(entry.icon || "🍽️")} ${escapeHtml(entry.label || entry.key)}</span>
        </span>
        <span class="nutrition-legend-values">${escapeHtml(String(entry.sharePct))}% • ${escapeHtml(String(Math.round(entry.kcal)))} kcal</span>
      </li>
    `).join("");

    target.innerHTML = `
      <article class="nutrition-balance-card">
        <div class="nutrition-balance-head">
          <div>
            <p class="panel-kicker">Répartition nutritionnelle récente</p>
            <h3 class="title-with-icon small"><span class="title-icon" aria-hidden="true">🥗</span><span>30 derniers jours</span></h3>
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

function renderRecentMeals(data) {
  const container = document.getElementById("recent-meals");
  const pagination = document.getElementById("recent-meals-pagination");
  const meals = data.recentMeals || [];
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

  visibleMeals.forEach((meal) => {
    const article = document.createElement("article");
    article.className = "meal-card";
    const estimatedCount = (meal.items || []).filter((item) => item.quantitySource === "estimated").length;
    const assessment = meal.assessment || {};
    const recommendations = (assessment.recommendations || []).filter(Boolean);
    const hasAssessment = assessment.estimatedEnergyKcal || assessment.qualityScore || recommendations.length;
    const hasScore = assessment.qualityScore !== null && assessment.qualityScore !== undefined && assessment.qualityScore !== "";
    const badgeTone = hasScore ? mealScoreTone(assessment.qualityScore) : (estimatedCount ? "estimated" : "exact");
    const badgeLabel = hasScore ? `Score ${assessment.qualityScore}/100` : (estimatedCount ? `${estimatedCount} estimés` : "Structure");
    article.innerHTML = `
      <div class="meal-card-head">
        <div>
          <div class="meal-card-kicker">${escapeHtml(meal.mealTypeIcon || "🍽️")} ${escapeHtml(meal.date || "Date inconnue")}</div>
          <h3>${escapeHtml(meal.mealTypeLabel || prettyLabel(meal.mealType) || "Repas")}</h3>
          <div class="meal-meta">
            <span>${escapeHtml(meal.time || "Heure non précisée")}</span>
            <span>${escapeHtml(prettyLabel(meal.captureMethod || "manual"))}</span>
            <span>${escapeHtml(prettyLabel(meal.confidence || "unknown"))} confiance</span>
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
                ) : ""}
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    container.appendChild(article);
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
  const body = document.getElementById("food-table-body");
  const pagination = document.getElementById("food-table-pagination");
  body.innerHTML = "";
  if (pagination) pagination.innerHTML = "";
  const foods = data.foodFrequency || [];
  if (!foods.length) {
    body.innerHTML = `<tr><td colspan="6">Aucune fréquence alimentaire disponible pour le moment. Commence à saisir des repas pour remplir cette table.</td></tr>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(foods.length / FOODS_PER_PAGE));
  state.foodsPage = Math.min(Math.max(state.foodsPage, 1), totalPages);
  const startIndex = (state.foodsPage - 1) * FOODS_PER_PAGE;
  const visibleFoods = foods.slice(startIndex, startIndex + FOODS_PER_PAGE);

  visibleFoods.forEach((row) => {
    const categoryKeys = row.categoryKeys || row.category_keys || (row.category_key ? [row.category_key] : []);
    const categoryLabels = row.categoryLabels || row.category_labels || (row.category_label ? [row.category_label] : []);
    const icon = row.icon || "🍽️";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="food-name-cell"><span class="food-name-icon">${escapeHtml(icon)}</span><span>${escapeHtml(row.label || row.food_key || "Inconnu")}</span></span></td>
      <td>${categoryKeys.length ? foodCategoryChips(categoryKeys, categoryLabels) : "—"}</td>
      <td>${escapeHtml(String(row.occurrence_count || ""))}</td>
      <td>${escapeHtml(String(row.distinct_days || ""))}</td>
      <td>${escapeHtml(row.total_quantity ? `${row.total_quantity} ${row.unit || ""}` : "—")}</td>
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

function renderApp(data) {
  renderFreshness(data);
  renderFoodTable(data);
  renderSignals(data);
  renderNutritionBalance(data);
  renderRecentMeals(data);
  renderReferenceSections(data);
  renderLabs(data);
  renderDigestiveFocus(data);
  renderLabHistory(data);
  renderWeightChart(data);
  renderMonthlyBars(data);
  renderTimeline(data);
  renderDocuments(data);
}

function setupReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
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
      renderApp(state.dashboard);
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
  state.dashboard = await loadDashboard();
  renderApp(state.dashboard);
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
