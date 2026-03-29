const state = { dashboard: null };

async function loadDashboard() {
  const response = await fetch("./data/dashboard.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load dashboard data: ${response.status}`);
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

function renderRecentMeals(data) {
  const container = document.getElementById("recent-meals");
  const meals = data.recentMeals || [];
  container.innerHTML = "";
  if (!meals.length) {
    container.innerHTML = `<div class="empty-state">Aucun repas saisi pour le moment. Les prochains repas apparaitront ici en premier.</div>`;
    return;
  }

  meals.forEach((meal) => {
    const article = document.createElement("article");
    article.className = "meal-card";
    const estimatedCount = (meal.items || []).filter((item) => item.quantitySource === "estimated").length;
    article.innerHTML = `
      <div class="meal-card-head">
        <div>
          <div class="meal-card-kicker">${escapeHtml(meal.mealTypeIcon || "🍽️")} ${escapeHtml(meal.date || "Date inconnue")}</div>
          <h3>${escapeHtml(meal.mealTypeLabel || prettyLabel(meal.mealType) || "Repas")}</h3>
          <div class="meal-meta">
            <span>${escapeHtml(meal.time || "Heure non precisee")}</span>
            <span>${escapeHtml(prettyLabel(meal.captureMethod || "manual"))}</span>
            <span>${escapeHtml(prettyLabel(meal.confidence || "unknown"))} confiance</span>
          </div>
        </div>
        <div class="meal-badge" data-tone="${estimatedCount ? "estimated" : "exact"}">
          ${estimatedCount ? `${estimatedCount} estimes` : "Structure"}
        </div>
      </div>
      <p class="meal-source">${escapeHtml(meal.sourceText || meal.notes || "Aucune description disponible.")}</p>
      <div class="meal-item-list">
        ${(meal.items || []).map((item) => `
          <div class="meal-item">
            <div class="meal-item-icon">${escapeHtml(item.icon || "🍽️")}</div>
            <div>
              <div class="meal-item-top">
                <strong>${escapeHtml(item.label || "Element inconnu")}</strong>
                <span class="food-portion">${escapeHtml(item.quantityText || item.portionText || "")}</span>
              </div>
              <div class="food-meta">
                ${item.portionText && item.quantityText ? `<span>${escapeHtml(item.portionText)}</span>` : ""}
                ${item.quantitySource ? `<span class="food-estimate">${escapeHtml(prettyLabel(item.quantitySource))}</span>` : ""}
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    container.appendChild(article);
  });
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
    breakfast: "Petit dejeuner",
    lunch: "Dejeuner",
    dinner: "Diner",
    snack: "Collation",
    exact: "Exact",
    estimated: "Estime",
    unknown: "Inconnu",
    manual: "Manuel",
    realtime: "Temps Reel",
    same_day_recall: "Rappel Meme Jour",
    historical_recall: "Rappel Historique",
    import: "Import",
    high: "Elevee",
    medium: "Moyenne",
    low: "Faible",
    normal: "Normal",
    info: "Info",
    active: "Actif",
    resolved: "Resolue",
    diagnosis: "Diagnostic",
    note: "Note",
    appointment: "Consultation",
    tracked: "Suivi",
    event: "Evenement",
  };
  const raw = String(value || "");
  return translated[raw] || raw.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function fallbackFoodIcon(foodKey, label) {
  const haystack = `${foodKey || ""} ${label || ""}`.toLowerCase();
  if (haystack.includes("egg") || haystack.includes("oeuf")) return "🍳";
  if (haystack.includes("bread") || haystack.includes("pain")) return "🍞";
  if (haystack.includes("juice") || haystack.includes("jus") || haystack.includes("orange")) return "🍊";
  if (haystack.includes("cheese") || haystack.includes("fromage") || haystack.includes("comte")) return "🧀";
  if (haystack.includes("rice") || haystack.includes("riz")) return "🍚";
  if (haystack.includes("pasta") || haystack.includes("pates")) return "🍝";
  if (haystack.includes("burger")) return "🍔";
  if (haystack.includes("fries") || haystack.includes("frites")) return "🍟";
  if (haystack.includes("legume") || haystack.includes("salade") || haystack.includes("vegetable")) return "🥦";
  if (haystack.includes("banana") || haystack.includes("banane")) return "🍌";
  return "🍽️";
}

function formatDelta(value) {
  if (value === null || value === undefined || value === "") return "Un seul point";
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric === 0) return "Stable vs precedent";
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
  if (!points.length) return `<div class="empty-state">Pas assez de valeurs numeriques.</div>`;

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
    { title: "Identite et situation actuelle", keys: ["Identite et situation actuelle", "Identity And Current Snapshot"] },
    { title: "Conditions actives et diagnostics", keys: ["Conditions actives et diagnostics", "Active Conditions And Diagnoses"] },
    { title: "Allergies et intolerances", keys: ["Allergies et intolerances", "Allergies And Intolerances"] },
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
    ? `Dernier bilan structure: ${data.latestLabDate}.`
    : "Aucun bilan structure disponible pour le moment.";
  const grid = document.getElementById("lab-grid");
  grid.innerHTML = "";
  if (!data.latestLabCards.length) {
    grid.innerHTML = `<div class="empty-state">Aucun marqueur cle disponible pour le moment.</div>`;
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
    focus.summary || "Aucun resume digestif disponible pour le moment.";
  document.getElementById("digestive-management").textContent =
    focus.management || focus.lactoseNote || "Aucune note de gestion disponible pour le moment.";

  const triggerList = document.getElementById("digestive-trigger-list");
  triggerList.innerHTML = "";
  const triggers = [...(focus.triggers || [])];
  if (focus.lactoseNote) triggers.push("Sensibilite au lactose documentee");
  if (!triggers.length) {
    triggerList.innerHTML = `<div class="empty-state">Aucun declencheur digestif structure pour le moment.</div>`;
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
    conditions.innerHTML = `<div class="empty-state">Aucune condition digestive concernee pour le moment.</div>`;
  } else {
    focus.conditions.forEach((condition) => {
      const item = document.createElement("article");
      item.className = "stack-item";
      item.innerHTML = `
        <div class="stack-meta"><span>${escapeHtml(prettyLabel(condition.status || "tracked"))}</span></div>
        <h4>${escapeHtml(condition.label || "Condition sans nom")}</h4>
        <p>${escapeHtml(condition.notes || "Aucune note complementaire.")}</p>
      `;
      conditions.appendChild(item);
    });
  }

  const events = document.getElementById("digestive-events");
  events.innerHTML = "";
  if (!(focus.events || []).length) {
    events.innerHTML = `<div class="empty-state">Aucun point de repere digestif disponible pour le moment.</div>`;
  } else {
    focus.events.forEach((event) => {
      const item = document.createElement("article");
      item.className = "stack-item";
      item.innerHTML = `
        <div class="stack-meta">
          <span>${escapeHtml(event.date || "Date inconnue")}</span>
          <span>${escapeHtml(prettyLabel(event.type || "event"))}</span>
        </div>
        <h4>${escapeHtml(event.title || "Evenement sans titre")}</h4>
        <p>${escapeHtml(event.notes || "Aucune note enregistree.")}</p>
      `;
      events.appendChild(item);
    });
  }

  const labs = document.getElementById("digestive-labs");
  labs.innerHTML = "";
  if (!(focus.labs || []).length) {
    labs.innerHTML = `<div class="empty-state">Aucun bilan digestif utile structure pour le moment.</div>`;
  } else {
    focus.labs.forEach((lab) => {
      const item = document.createElement("article");
      item.className = "mini-lab-card";
      item.dataset.status = lab.status || "info";
      item.innerHTML = `
        <strong>${escapeHtml(lab.label || "Marqueur inconnu")}</strong>
        <div class="mini-lab-value">${escapeHtml(String(lab.value || "—"))}</div>
        <div class="mini-lab-meta">
          <span>${escapeHtml(lab.unit || "sans unite")}</span>
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
    target.innerHTML = `<div class="empty-state">Aucun marqueur recurrent disponible pour le moment.</div>`;
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
      <p>${escapeHtml(entry.previousDate ? `Precedent: ${entry.previousValue} le ${entry.previousDate}` : "Un seul point connu pour le moment.")}</p>
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
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolution du poids">
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
    target.innerHTML = `<div class="empty-state">Aucun resume mensuel disponible pour le moment.</div>`;
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
      <h3>${escapeHtml(item.title || "Evenement sans titre")}</h3>
      <p>${escapeHtml(item.notes || "")}</p>
      <div class="timeline-meta"><span>${escapeHtml(item.practitioner || "Aucun praticien renseigne")}</span></div>
    `;
    target.appendChild(article);
  });
}

function renderFoodTable(data) {
  const body = document.getElementById("food-table-body");
  body.innerHTML = "";
  const foods = data.foodFrequency || [];
  if (!foods.length) {
    body.innerHTML = `<tr><td colspan="5">Aucune frequence alimentaire disponible pour le moment. Commence a saisir des repas pour remplir cette table.</td></tr>`;
    return;
  }
  foods.forEach((row) => {
    const icon = fallbackFoodIcon(row.food_key, row.label);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="food-name-cell"><span class="food-name-icon">${escapeHtml(icon)}</span><span>${escapeHtml(row.label || row.food_key || "Inconnu")}</span></span></td>
      <td>${escapeHtml(String(row.occurrence_count || ""))}</td>
      <td>${escapeHtml(String(row.distinct_days || ""))}</td>
      <td>${escapeHtml(row.total_quantity ? `${row.total_quantity} ${row.unit || ""}` : "—")}</td>
      <td>${escapeHtml(row.portion_text_examples || "—")}</td>
    `;
    body.appendChild(tr);
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

async function boot() {
  state.dashboard = await loadDashboard();
  renderFoodTable(state.dashboard);
  renderSignals(state.dashboard);
  renderRecentMeals(state.dashboard);
  renderReferenceSections(state.dashboard);
  renderLabs(state.dashboard);
  renderDigestiveFocus(state.dashboard);
  renderLabHistory(state.dashboard);
  renderWeightChart(state.dashboard);
  renderMonthlyBars(state.dashboard);
  renderTimeline(state.dashboard);
  renderDocuments(state.dashboard);
  setupReveal();
  setupLiveReload();
}

boot().catch((error) => {
  document.body.innerHTML = `
    <main style="padding:32px; font-family: 'IBM Plex Mono', monospace;">
      <h1>Chargement du tableau de bord impossible</h1>
      <pre>${escapeHtml(error.stack || error.message)}</pre>
    </main>
  `;
  console.error(error);
});
