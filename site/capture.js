const SHARE_CACHE = "atlas-share-target-v1";
const SHARE_FILE_PREFIX = "/__share-target/";
const SHARE_META_PREFIX = "/__share-target-meta/";

const state = {
  file: null,
  previewUrl: "",
  draft: null,
  captureId: "",
  commitMode: "save",
  ticket: null,
  ticketExpiresAt: 0,
  captureApiBase: "",
  history: [],
};

const elements = {
  photoInput: document.getElementById("photo-input"),
  shareHint: document.getElementById("share-hint"),
  photoPreview: document.getElementById("photo-preview"),
  photoPreviewEmpty: document.getElementById("photo-preview-empty"),
  photoMeta: document.getElementById("photo-meta"),
  captureAutoNote: document.getElementById("capture-auto-note"),
  analyzeButton: document.getElementById("analyze-photo"),
  captureStatus: document.getElementById("capture-status"),
  captureStatusChip: document.getElementById("capture-status-chip"),
  analysisResult: document.getElementById("analysis-result"),
  reviewForm: document.getElementById("review-form"),
  reviewSummary: document.getElementById("review-summary"),
  draftDate: document.getElementById("draft-date"),
  draftTime: document.getElementById("draft-time"),
  draftMealType: document.getElementById("draft-meal-type"),
  draftConfidence: document.getElementById("draft-confidence"),
  draftSourceText: document.getElementById("draft-source-text"),
  draftAssessment: document.getElementById("draft-assessment"),
  draftAssessmentNotes: document.getElementById("draft-assessment-notes"),
  draftItems: document.getElementById("draft-items"),
  addItem: document.getElementById("add-item"),
  commitStatus: document.getElementById("commit-status"),
  commitDraft: document.getElementById("commit-draft"),
  captureHistory: document.getElementById("capture-history"),
  captureHistorySummary: document.getElementById("capture-history-summary"),
  itemTemplate: document.getElementById("capture-item-template"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, tone = "info") {
  if (elements.captureStatus) {
    elements.captureStatus.textContent = message;
    elements.captureStatus.dataset.tone = tone;
  }
  if (elements.captureStatusChip) {
    elements.captureStatusChip.textContent = message;
    elements.captureStatusChip.dataset.tone = tone;
  }
}

function setCommitStatus(message, tone = "info") {
  if (!elements.commitStatus) return;
  elements.commitStatus.textContent = message;
  elements.commitStatus.dataset.tone = tone;
}

function setupReveal() {
  const nodes = Array.from(document.querySelectorAll(".reveal"));
  if (!nodes.length) return;
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  nodes.forEach((node) => observer.observe(node));
}

function setCommitAction(mode = "save") {
  if (!elements.commitDraft) return;
  elements.commitDraft.textContent = mode === "retry_refresh"
    ? "Relancer la mise à jour du site"
    : "Enregistrer le repas";
  state.commitMode = mode;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function normalizeCompareText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function draftSourceItems() {
  return Array.isArray(state.draft?.items) ? state.draft.items : [];
}

function itemSignature(item = {}) {
  return `${normalizeCompareText(item.label)} ${normalizeCompareText(item.food_key)}`;
}

function mealSignals(items = []) {
  const signatures = items.map((item) => itemSignature(item));
  const producePattern = /(fruit|legume|légume|salade|tomate|carotte|courgette|brocoli|haricot|concombre|poivron|soupe|pomme|banane|orange|fraise|kiwi|compote|ratatouille)/;
  const proteinPattern = /(oeuf|œuf|egg|poulet|dinde|thon|saumon|poisson|tofu|tempeh|skyr|yaourt|fromage blanc|viande|steak|jambon|lentille|pois chiche|edamame|protein|proteine|protéine)/;
  return {
    hasProduce: signatures.some((value) => producePattern.test(value)),
    hasProtein: signatures.some((value) => proteinPattern.test(value)),
  };
}

function deriveItemEnergyKcal(item, sourceItem = {}) {
  const sourceEnergy = parsePositiveNumber(sourceItem?.estimated_nutrition?.energy_kcal ?? sourceItem?.estimated_energy_kcal);
  if (!sourceEnergy) return null;
  if (normalizeCompareText(item.label) !== normalizeCompareText(sourceItem.label)) return null;

  const quantity = parsePositiveNumber(item.quantity);
  const sourceQuantity = parsePositiveNumber(sourceItem.quantity);
  const unit = String(item.unit || "");
  const sourceUnit = String(sourceItem.unit || "");
  if (quantity && sourceQuantity && unit && sourceUnit && unit === sourceUnit) {
    return roundToTenth(sourceEnergy * (quantity / sourceQuantity));
  }

  const portionText = normalizeCompareText(item.portion_text);
  const sourcePortionText = normalizeCompareText(sourceItem.portion_text);
  const sameQuantity = quantity && sourceQuantity && quantity === sourceQuantity && unit === sourceUnit;
  if (sameQuantity || (!quantity && !sourceQuantity && portionText && portionText === sourcePortionText)) {
    return roundToTenth(sourceEnergy);
  }
  return null;
}

function buildSerializedItems() {
  const sourceItems = draftSourceItems();
  return Array.from(elements.draftItems.querySelectorAll(".capture-item-row")).map((row, index) => {
    const sourceItem = (sourceItems[index] && typeof sourceItems[index] === "object") ? sourceItems[index] : {};
    const label = row.querySelector('[data-field="label"]').value.trim();
    if (!label) return null;

    const quantityValue = row.querySelector('[data-field="quantity"]').value;
    const quantity = quantityValue === "" ? null : Number(quantityValue);
    const item = {
      label,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: row.querySelector('[data-field="unit"]').value,
      portion_text: row.querySelector('[data-field="portion_text"]').value.trim(),
      notes: row.querySelector('[data-field="notes"]').value.trim(),
    };

    const labelMatchesSource = normalizeCompareText(label) === normalizeCompareText(sourceItem.label);
    if (labelMatchesSource && sourceItem.food_key) item.food_key = sourceItem.food_key;
    if (labelMatchesSource && sourceItem.preparation) item.preparation = sourceItem.preparation;

    const estimatedEnergyKcal = deriveItemEnergyKcal(item, sourceItem);
    if (estimatedEnergyKcal !== null) {
      item.estimated_energy_kcal = estimatedEnergyKcal;
    }

    if (item.quantity === null) delete item.quantity;
    if (!item.unit) delete item.unit;
    if (!item.portion_text) delete item.portion_text;
    if (!item.notes) delete item.notes;
    return item;
  }).filter(Boolean);
}

function assessmentInputsChanged(items, mealType) {
  const sourceItems = draftSourceItems();
  if (String(mealType || "") !== String(state.draft?.meal_type || "")) return true;
  if (items.length !== sourceItems.length) return true;
  return items.some((item, index) => {
    const sourceItem = sourceItems[index] || {};
    return normalizeCompareText(item.label) !== normalizeCompareText(sourceItem.label)
      || (item.quantity ?? null) !== (sourceItem.quantity ?? null)
      || String(item.unit || "") !== String(sourceItem.unit || "")
      || normalizeCompareText(item.portion_text) !== normalizeCompareText(sourceItem.portion_text);
  });
}

function deriveNutritionConfidence(items, fallback = "medium") {
  if (!items.length) return fallback;
  const knownItems = items.filter((item) => parsePositiveNumber(item.estimated_energy_kcal));
  if (!knownItems.length) return "low";
  if (knownItems.length === items.length) return fallback === "low" ? "medium" : fallback;
  return "medium";
}

function derivePortionConfidence(items, fallback = "medium") {
  if (!items.length) return fallback;
  const quantifiedItems = items.filter((item) => parsePositiveNumber(item.quantity) && item.unit);
  if (quantifiedItems.length === items.length) return quantifiedItems.length ? "medium" : fallback;
  return quantifiedItems.length ? "medium" : "low";
}

function deriveMealRecommendations(items, mealType, estimatedEnergyKcal) {
  const { hasProduce, hasProtein } = mealSignals(items);
  const recommendations = [];
  if (!hasProtein) recommendations.push("Ajouter une source de protéines.");
  if (!hasProduce) recommendations.push("Ajouter un fruit ou un légume.");
  if (mealType === "snack" && estimatedEnergyKcal > 450) {
    recommendations.push("Alléger la collation ou réduire la portion.");
  } else if (mealType === "dinner" && estimatedEnergyKcal > 850) {
    recommendations.push("Alléger le dîner ou réduire la portion.");
  } else if (estimatedEnergyKcal > 1000) {
    recommendations.push("Réduire la portion ou répartir ce repas.");
  }
  if (items.length === 1) recommendations.push("Compléter le repas avec un autre aliment.");
  return [...new Set(recommendations)].slice(0, 3);
}

function deriveQualityScore(items, mealType, estimatedEnergyKcal) {
  const { hasProduce, hasProtein } = mealSignals(items);
  let score = 52;
  if (items.length >= 2) score += 8;
  if (items.length >= 3) score += 4;
  if (hasProtein) score += 10;
  if (hasProduce) score += 10;
  if (!hasProtein) score -= 4;
  if (!hasProduce) score -= 4;

  if (estimatedEnergyKcal > 0) {
    if (mealType === "snack") {
      score += estimatedEnergyKcal <= 350 ? 6 : (estimatedEnergyKcal <= 500 ? 2 : -10);
    } else if (mealType === "breakfast") {
      score += (estimatedEnergyKcal >= 250 && estimatedEnergyKcal <= 700) ? 6 : (estimatedEnergyKcal > 850 ? -6 : 0);
    } else {
      score += (estimatedEnergyKcal >= 450 && estimatedEnergyKcal <= 900) ? 6 : (estimatedEnergyKcal > 1100 ? -8 : 0);
    }
  }

  return clamp(Math.round(score), 0, 100);
}

function buildMealAssessmentForCommit(items) {
  const sourceAssessment = (state.draft && typeof state.draft.meal_assessment === "object" && state.draft.meal_assessment) ? state.draft.meal_assessment : {};
  const mealType = elements.draftMealType.value || state.draft?.meal_type || "snack";
  const notes = elements.draftAssessmentNotes.value.trim();
  if (!assessmentInputsChanged(items, mealType)) {
    return {
      ...sourceAssessment,
      notes,
    };
  }

  const sourceEnergy = parsePositiveNumber(sourceAssessment.estimated_energy_kcal) || 0;
  const knownEnergyValues = items
    .map((item) => parsePositiveNumber(item.estimated_energy_kcal))
    .filter((value) => value !== null);
  const addedUnknownItem = items.length > draftSourceItems().length
    && items.some((item, index) => !draftSourceItems()[index] && !parsePositiveNumber(item.estimated_energy_kcal));
  const estimatedEnergyKcal = knownEnergyValues.length
    ? roundToTenth(addedUnknownItem ? Math.max(knownEnergyValues.reduce((sum, value) => sum + value, 0), sourceEnergy) : knownEnergyValues.reduce((sum, value) => sum + value, 0))
    : sourceEnergy;
  const nutritionConfidence = deriveNutritionConfidence(items, sourceAssessment.nutrition_confidence || sourceAssessment.estimation_confidence || "medium");
  const recommendations = deriveMealRecommendations(items, mealType, estimatedEnergyKcal);

  return {
    ...sourceAssessment,
    estimated_energy_kcal: estimatedEnergyKcal,
    quality_score: deriveQualityScore(items, mealType, estimatedEnergyKcal),
    image_confidence: sourceAssessment.image_confidence || state.draft?.confidence || "medium",
    portion_confidence: derivePortionConfidence(items, sourceAssessment.portion_confidence || state.draft?.confidence || "medium"),
    nutrition_confidence: nutritionConfidence,
    estimation_confidence: nutritionConfidence,
    recommendations,
    notes,
  };
}

function refreshDraftAssessmentPreview() {
  if (!state.draft || elements.reviewForm.hidden) return;
  const items = buildSerializedItems();
  renderAssessment({
    ...state.draft,
    meal_type: elements.draftMealType.value || state.draft.meal_type,
    items,
    meal_assessment: buildMealAssessmentForCommit(items),
  });
}

function confidenceLabel(value) {
  const tone = String(value || "medium").toLowerCase();
  if (tone === "high") return "élevée";
  if (tone === "low") return "faible";
  return "moyenne";
}

function confidencePillsMarkup(assessment = {}, draft = {}) {
  const descriptors = [
    { label: "Image", value: assessment.image_confidence || draft.confidence || "medium" },
    { label: "Portions", value: assessment.portion_confidence || assessment.estimation_confidence || draft.confidence || "medium" },
    { label: "Nutrition", value: assessment.nutrition_confidence || assessment.estimation_confidence || draft.confidence || "medium" },
  ];
  return `
    <div class="capture-confidence-grid">
      ${descriptors.map((entry) => `
        <div class="capture-confidence-pill" data-tone="${escapeHtml(entry.value)}">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${escapeHtml(confidenceLabel(entry.value))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

function getQueryParam(key) {
  return new URLSearchParams(window.location.search).get(key) || "";
}

function setPreview(file) {
  state.file = file;
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
  if (!file) {
    elements.photoPreview.removeAttribute("src");
    elements.photoPreview.hidden = true;
    elements.photoPreviewEmpty.hidden = false;
    elements.photoMeta.innerHTML = "";
    return;
  }
  state.previewUrl = URL.createObjectURL(file);
  elements.photoPreview.src = state.previewUrl;
  elements.photoPreview.hidden = false;
  elements.photoPreviewEmpty.hidden = true;
  elements.photoMeta.innerHTML = `
    <span class="utility-meta">${escapeHtml(file.name || "photo")}</span>
    <span class="utility-meta">${escapeHtml(formatBytes(file.size))}</span>
    <span class="utility-meta">${escapeHtml(file.type || "image/*")}</span>
  `;
}

function appendItemRow(item = {}) {
  const fragment = buildItemRow(item);
  elements.draftItems.appendChild(fragment);
  return elements.draftItems.lastElementChild;
}

async function loadSharedFile(shareId) {
  const cache = await caches.open(SHARE_CACHE);
  const fileResponse = await cache.match(`${SHARE_FILE_PREFIX}${shareId}`);
  const metaResponse = await cache.match(`${SHARE_META_PREFIX}${shareId}`);
  if (!fileResponse || !metaResponse) return false;
  const blob = await fileResponse.blob();
  const meta = await metaResponse.json();
  const file = new File([blob], meta.name || "meal-photo.jpg", {
    type: meta.type || blob.type || "image/jpeg",
    lastModified: meta.lastModified || Date.now(),
  });
  setPreview(file);
  elements.shareHint.textContent = "Photo reçue depuis le menu Partager Android.";
  return true;
}

async function cleanupSharedFile(shareId) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.delete(`${SHARE_FILE_PREFIX}${shareId}`);
  await cache.delete(`${SHARE_META_PREFIX}${shareId}`);
}

async function parseApiResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const rawText = await response.text();
  if (!rawText) return {};
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`Réponse JSON invalide (${response.status}).`);
    }
  }
  return response.ok ? { message: rawText } : { error: rawText };
}

function getRefreshInfo(payload) {
  return (payload && typeof payload.refresh === "object" && payload.refresh) ? payload.refresh : {};
}

function isPublishComplete(payload) {
  const refresh = getRefreshInfo(payload);
  return payload?.status === "committed" && refresh.status === "done" && refresh.published === true;
}

function isPublishFailed(payload) {
  return payload?.status === "committed" && getRefreshInfo(payload).status === "failed";
}

function isCommitStoredOnly(payload) {
  const refresh = getRefreshInfo(payload);
  return payload?.status === "committed" && refresh.status === "done" && refresh.published === false;
}

function refreshLabel(payload) {
  const refresh = getRefreshInfo(payload);
  if (refresh.status === "done" && refresh.published === true) return "site mis à jour";
  if (refresh.status === "done" && refresh.published === false) return "publication non lancée";
  if (refresh.status === "failed") return "publication échouée";
  if (refresh.status === "running") return "publication en cours";
  return "publication inconnue";
}

async function getTicket(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && state.ticket && now < state.ticketExpiresAt - 10_000) {
    return state.ticket;
  }

  const accessToken = await window.__atlasGetAccessToken?.(true);
  if (!accessToken) throw new Error("Impossible de récupérer un jeton de session Netlify.");

  const response = await fetch("/.netlify/functions/create-intake-ticket", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const payload = await parseApiResponse(response);
  if (!response.ok) throw new Error(payload.error || `Échec ticket upload (${response.status}).`);

  state.ticket = payload;
  state.ticketExpiresAt = Date.parse(payload.expires_at || "") || Date.now();
  state.captureApiBase = String(payload.upload_url || "").replace(/\/v1\/meal-photo-intake$/, "");
  return payload;
}

function sharedAtFromFile(file) {
  if (!file || !file.lastModified) return "";
  return new Date(file.lastModified).toISOString();
}

function updateUrl(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });
  window.history.replaceState({}, "", url.toString());
}

function renderAnalysisSummary(payload) {
  const draft = payload?.draft || {};
  const assessment = draft.meal_assessment || {};
  const recommendations = Array.isArray(assessment.recommendations) ? assessment.recommendations : [];
  const items = Array.isArray(draft.items) ? draft.items : [];
  elements.analysisResult.classList.remove("empty-state");
  elements.analysisResult.innerHTML = `
    <div class="capture-summary-grid">
      <div class="utility-meta">Statut: ${escapeHtml(payload.status || "inconnu")}</div>
      <div class="utility-meta">Heure: ${escapeHtml(draft.time || "non précisée")}</div>
      <div class="utility-meta">Repas: ${escapeHtml(draft.meal_type || "inconnu")}</div>
      <div class="utility-meta">Confiance: ${escapeHtml(draft.confidence || "medium")}</div>
      <div class="utility-meta">kcal: ${escapeHtml(assessment.estimated_energy_kcal ?? "?")}</div>
      <div class="utility-meta">Score: ${escapeHtml(`${assessment.quality_score ?? "?"}/100`)}</div>
      <div class="utility-meta">Publication: ${escapeHtml(refreshLabel(payload))}</div>
    </div>
    ${confidencePillsMarkup(assessment, draft)}
    <p>${escapeHtml(draft.source_text || "Aucune description source.")}</p>
    <p>${escapeHtml(assessment.notes || "")}</p>
    ${items.length ? `<p><strong>Aliments détectés:</strong> ${escapeHtml(items.map((item) => item.label).join(", "))}</p>` : ""}
    ${recommendations.length ? `<div class="capture-recommendations">${recommendations.map((value) => `<span class="utility-meta">${escapeHtml(value)}</span>`).join("")}</div>` : ""}
  `;
}

function renderAssessment(draft) {
  const assessment = draft.meal_assessment || {};
  const recommendations = Array.isArray(assessment.recommendations) ? assessment.recommendations : [];
  elements.draftAssessment.innerHTML = `
    <div class="utility-meta">kcal estimées: ${escapeHtml(assessment.estimated_energy_kcal ?? "?")}</div>
    <div class="utility-meta">Score heuristique: ${escapeHtml(`${assessment.quality_score ?? "?"}/100`)}</div>
    <div class="utility-meta">Fiabilité: ${escapeHtml(assessment.estimation_confidence || "medium")}</div>
    ${recommendations.map((value) => `<div class="utility-meta">${escapeHtml(value)}</div>`).join("")}
    ${confidencePillsMarkup(assessment, draft)}
  `;
}

function buildItemRow(item = {}) {
  const fragment = elements.itemTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".capture-item-row");
  row.querySelector('[data-field="label"]').value = item.label || "";
  row.querySelector('[data-field="quantity"]').value = item.quantity ?? "";
  row.querySelector('[data-field="unit"]').value = item.unit || "";
  row.querySelector('[data-field="portion_text"]').value = item.portion_text || "";
  row.querySelector('[data-field="notes"]').value = item.notes || "";
  return fragment;
}

function renderDraftForm(draft) {
  state.draft = draft;
  elements.reviewForm.hidden = false;
  setCommitAction("save");
  elements.reviewSummary.textContent = draft.auto_commit_eligible
    ? "La photo était assez nette pour un auto-commit, mais tu peux encore ajuster ce brouillon."
    : "L’analyse a produit un brouillon à valider avant écriture.";
  elements.draftDate.value = draft.date || "";
  elements.draftTime.value = draft.time || "";
  elements.draftMealType.value = draft.meal_type || "snack";
  elements.draftConfidence.value = draft.confidence || "medium";
  elements.draftSourceText.value = draft.source_text || "";
  elements.draftAssessmentNotes.value = draft.meal_assessment?.notes || "";
  renderAssessment(draft);
  elements.draftItems.innerHTML = "";
  (draft.items || []).forEach((item) => {
    appendItemRow(item);
  });
  if (!(draft.items || []).length) {
    appendItemRow();
  }
}

function renderRefreshRetryState(payload, message) {
  renderDraftForm(payload.draft || {});
  setCommitAction("retry_refresh");
  elements.reviewSummary.textContent = "Le repas est déjà enregistré dans les imports privés. Le bouton relance uniquement la mise à jour du site.";
  setStatus(message, "error");
  setCommitStatus(getRefreshInfo(payload).error || "Relance la publication pour réessayer le rebuild du site.", "error");
}

function serializeDraft() {
  const items = buildSerializedItems();

  return {
    ...state.draft,
    date: elements.draftDate.value,
    time: elements.draftTime.value,
    meal_type: elements.draftMealType.value,
    confidence: elements.draftConfidence.value,
    source_text: elements.draftSourceText.value.trim(),
    meal_assessment: buildMealAssessmentForCommit(items),
    items,
  };
}

function appendReviewNote(note) {
  if (!elements.draftAssessmentNotes || !note) return;
  const current = elements.draftAssessmentNotes.value.trim();
  if (current.includes(note)) return;
  elements.draftAssessmentNotes.value = current ? `${current} ${note}` : note;
}

function adjustDraftQuantities(factor) {
  const rows = Array.from(elements.draftItems.querySelectorAll(".capture-item-row"));
  let adjusted = 0;
  rows.forEach((row) => {
    const input = row.querySelector('[data-field="quantity"]');
    const current = Number(input.value);
    if (!Number.isFinite(current) || current <= 0) return;
    input.value = String((Math.round(current * factor * 10) / 10));
    adjusted += 1;
  });
  return adjusted;
}

function runQuickAction(action) {
  if (elements.reviewForm.hidden) return;
  switch (action) {
    case "meal-breakfast":
      elements.draftMealType.value = "breakfast";
      setCommitStatus("Type de repas ajusté en petit déjeuner.", "info");
      break;
    case "meal-lunch":
      elements.draftMealType.value = "lunch";
      setCommitStatus("Type de repas ajusté en déjeuner.", "info");
      break;
    case "meal-dinner":
      elements.draftMealType.value = "dinner";
      setCommitStatus("Type de repas ajusté en dîner.", "info");
      break;
    case "meal-snack":
      elements.draftMealType.value = "snack";
      setCommitStatus("Type de repas ajusté en collation.", "info");
      break;
    case "portion-down": {
      const adjusted = adjustDraftQuantities(0.8);
      appendReviewNote("Portions revues à la baisse manuellement.");
      setCommitStatus(adjusted ? "Quantités réduites de 20 %." : "Aucune quantité chiffrée à réduire.", adjusted ? "info" : "error");
      break;
    }
    case "portion-up": {
      const adjusted = adjustDraftQuantities(1.2);
      appendReviewNote("Portions revues à la hausse manuellement.");
      setCommitStatus(adjusted ? "Quantités augmentées de 20 %." : "Aucune quantité chiffrée à augmenter.", adjusted ? "info" : "error");
      break;
    }
    case "add-missing-item": {
      const row = appendItemRow();
      row?.querySelector('[data-field="label"]')?.focus();
      appendReviewNote("Un aliment manquant a été ajouté au brouillon.");
      setCommitStatus("Ajoute l’aliment manquant puis enregistre.", "info");
      break;
    }
    case "time-ok":
      appendReviewNote("Heure vérifiée manuellement.");
      setCommitStatus("Le brouillon note que l’heure a été vérifiée.", "info");
      break;
    default:
      break;
  }
  refreshDraftAssessmentPreview();
}

function captureStatusLabel(payload) {
  if (payload.status === "committed" && isPublishComplete(payload)) return "Publié";
  if (payload.status === "committed") return "Enregistré";
  if (payload.status === "needs_review") return "Brouillon";
  if (payload.status === "failed") return "Échec";
  if (payload.status === "processing") return "Analyse";
  return payload.status || "Inconnu";
}

function canOpenHistoryCapture(payload = {}) {
  return Boolean(payload.captureId) && !["failed", "processing"].includes(String(payload.status || ""));
}

function renderHistory(captures = []) {
  state.history = captures;
  if (!elements.captureHistory || !elements.captureHistorySummary) return;
  elements.captureHistorySummary.textContent = captures.length
    ? `${captures.length} capture${captures.length > 1 ? "s" : ""} récente${captures.length > 1 ? "s" : ""} disponible${captures.length > 1 ? "s" : ""}.`
    : "Les brouillons et imports photo récents apparaissent ici.";
  if (!captures.length) {
    elements.captureHistory.innerHTML = `<div class="empty-state">Aucune capture récente pour le moment.</div>`;
    return;
  }
  elements.captureHistory.innerHTML = captures.map((payload) => {
    const draft = payload.draft || {};
    const assessment = draft.meal_assessment || {};
    const labels = Array.isArray(draft.items) ? draft.items.map((item) => item.label).filter(Boolean).slice(0, 3) : [];
    return `
      <article class="capture-history-card">
        <div class="capture-history-top">
          <div>
            <h3>${escapeHtml(draft.meal_type || "Capture photo")} · ${escapeHtml(draft.time || "heure inconnue")}</h3>
            <div class="capture-history-meta">
              <span class="utility-meta">${escapeHtml(payload.createdAt || payload.updatedAt || "")}</span>
              <span class="utility-meta">${escapeHtml(captureStatusLabel(payload))}</span>
              <span class="utility-meta">${escapeHtml(refreshLabel(payload))}</span>
            </div>
          </div>
          <div class="utility-meta">${escapeHtml(String(assessment.estimated_energy_kcal ?? "—"))} kcal</div>
        </div>
        ${confidencePillsMarkup(assessment, draft)}
        <p>${escapeHtml(labels.join(", ") || draft.source_text || "Photo sans résumé.")}</p>
        ${canOpenHistoryCapture(payload) ? `
          <div class="capture-history-actions">
            <button class="utility-button utility-button-secondary" data-action="open-history-capture" data-capture-id="${escapeHtml(payload.captureId || "")}" type="button">Ouvrir</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

async function fetchCaptureHistory() {
  try {
    const ticket = await getTicket(false);
    const response = await fetch(`${state.captureApiBase}/v1/meal-photo-intake?ticket=${encodeURIComponent(ticket.ticket)}&limit=8`, {
      method: "GET",
      mode: "cors",
    });
    const payload = await parseApiResponse(response);
    if (!response.ok) throw new Error(payload.error || `Historique indisponible (${response.status}).`);
    renderHistory(Array.isArray(payload.captures) ? payload.captures : []);
  } catch (error) {
    console.warn("Capture history unavailable.", error);
  }
}

async function openHistoryCapture(captureId) {
  if (!captureId) return;
  const capture = state.history.find((entry) => entry.captureId === captureId);
  if (capture && !canOpenHistoryCapture(capture)) {
    setStatus(capture.error || "Cette capture n’a pas de brouillon exploitable à rouvrir.", "error");
    return;
  }
  updateUrl({ capture_id: captureId, share_id: "" });
  await refreshExistingCapture();
}

async function uploadPhoto({ auto = false } = {}) {
  if (!state.file) {
    setStatus("Choisis d’abord une photo.", "error");
    return;
  }
  if (elements.analyzeButton.disabled) return;
  const ticket = await getTicket(true);
  setStatus(auto ? "Photo reçue, analyse automatique en cours…" : "Analyse de la photo en cours…", "info");
  elements.analyzeButton.disabled = true;
  if (elements.captureAutoNote) {
    elements.captureAutoNote.textContent = auto
      ? "Photo partagée détectée: l’analyse démarre automatiquement."
      : "Tu peux relancer l’analyse manuellement si besoin.";
  }

  try {
    const formData = new FormData();
    formData.append("ticket", ticket.ticket);
    formData.append("shared_at", sharedAtFromFile(state.file));
    formData.append("photo", state.file, state.file.name || "meal-photo.jpg");
    const response = await fetch(ticket.upload_url, {
      method: "POST",
      body: formData,
      mode: "cors",
    });
    const payload = await parseApiResponse(response);
    if (!response.ok) throw new Error(payload.error || `Upload refusé (${response.status}).`);

    state.captureId = payload.captureId || "";
    updateUrl({ capture_id: state.captureId, share_id: "" });
    renderAnalysisSummary(payload);

    if (payload.captureId && payload.status === "committed") {
      if (isPublishComplete(payload)) {
        setStatus("Repas enregistré et site mis à jour.", "success");
        setCommitStatus("Le repas a été ajouté automatiquement.", "success");
        elements.reviewForm.hidden = true;
      } else if (isPublishFailed(payload)) {
        renderRefreshRetryState(payload, "Repas enregistré, mais la mise à jour du site a échoué.");
      } else if (isCommitStoredOnly(payload)) {
        setStatus("Repas enregistré. Publication du site non lancée.", "info");
        setCommitStatus("Le repas a été écrit dans les imports privés.", "info");
        elements.reviewForm.hidden = true;
      } else {
        setStatus("Repas enregistré. Vérifie l’état de publication du site.", "info");
        setCommitStatus("Le repas est enregistré, mais le statut de publication reste incertain.", "info");
        elements.reviewForm.hidden = true;
      }
    } else {
      setStatus("Brouillon généré. Vérifie les aliments avant enregistrement.", "info");
      setCommitStatus("Le brouillon peut être ajusté puis enregistré.", "info");
      renderDraftForm(payload.draft || {});
    }

    const shareId = getQueryParam("share_id");
    if (shareId) await cleanupSharedFile(shareId);
    await fetchCaptureHistory();
  } finally {
    elements.analyzeButton.disabled = false;
  }
}

async function refreshExistingCapture() {
  const captureId = getQueryParam("capture_id");
  if (!captureId) return;
  const ticket = await getTicket(true);
  const response = await fetch(`${state.captureApiBase}/v1/meal-photo-intake/${encodeURIComponent(captureId)}?ticket=${encodeURIComponent(ticket.ticket)}`, {
    method: "GET",
    mode: "cors",
  });
  const payload = await parseApiResponse(response);
  if (!response.ok) throw new Error(payload.error || `Chargement capture impossible (${response.status}).`);
  state.captureId = payload.captureId || captureId;
  renderAnalysisSummary(payload);
  if (payload.status === "failed") {
    elements.reviewForm.hidden = true;
    setCommitAction("save");
    setStatus(payload.error || "Cette capture a échoué pendant l’analyse.", "error");
    setCommitStatus(payload.error || "Cette capture n’a pas de brouillon exploitable.", "error");
    await fetchCaptureHistory();
    return;
  }
  if (payload.status === "processing") {
    elements.reviewForm.hidden = true;
    setCommitAction("save");
    setStatus("Cette capture est encore en cours d’analyse.", "info");
    setCommitStatus("Attends la fin de l’analyse avant de rouvrir cette capture.", "info");
    await fetchCaptureHistory();
    return;
  }
  if (payload.status === "committed") {
    if (isPublishFailed(payload)) {
      renderRefreshRetryState(payload, "Cette capture est enregistrée, mais la mise à jour du site a échoué.");
      return;
    }
    elements.reviewForm.hidden = true;
    setCommitAction("save");
    if (isPublishComplete(payload)) {
      setStatus("Cette capture est déjà enregistrée.", "success");
      setCommitStatus("Le repas a déjà été écrit et publié.", "success");
    } else if (isCommitStoredOnly(payload)) {
      setStatus("Cette capture est enregistrée. Publication du site non lancée.", "info");
      setCommitStatus("Le repas existe dans les imports privés.", "info");
    } else {
      setStatus("Cette capture est déjà enregistrée.", "success");
      setCommitStatus("Le repas a déjà été écrit dans les imports privés.", "success");
    }
    return;
  }
  renderDraftForm(payload.draft || {});
  setStatus("Brouillon rechargé.", "info");
  await fetchCaptureHistory();
}

async function commitDraft(event) {
  event.preventDefault();
  if (!state.captureId) {
    setCommitStatus("Aucune capture active à enregistrer.", "error");
    return;
  }
  const ticket = await getTicket(true);
  setCommitStatus(
    state.commitMode === "retry_refresh"
      ? "Relance de la mise à jour du site en cours…"
      : "Écriture du repas et rebuild du site en cours…",
    "info",
  );
  elements.commitDraft.disabled = true;

  try {
    const response = await fetch(`${state.captureApiBase}/v1/meal-photo-intake/${encodeURIComponent(state.captureId)}/commit`, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket: ticket.ticket,
        draft: serializeDraft(),
      }),
    });
    const payload = await parseApiResponse(response);
    if (!response.ok) throw new Error(payload.error || `Commit refusé (${response.status}).`);
    renderAnalysisSummary(payload);
    if (isPublishComplete(payload)) {
      elements.reviewForm.hidden = true;
      setCommitAction("save");
      setCommitStatus("Repas enregistré. Le dashboard a été régénéré.", "success");
      setStatus("Repas photo enregistré avec succès.", "success");
    } else if (isPublishFailed(payload)) {
      renderRefreshRetryState(payload, "Le repas est enregistré, mais la mise à jour du site a échoué.");
    } else if (isCommitStoredOnly(payload)) {
      elements.reviewForm.hidden = true;
      setCommitAction("save");
      setCommitStatus("Repas enregistré dans les imports privés. Publication du site non lancée.", "info");
      setStatus("Repas photo enregistré.", "success");
    } else {
      elements.reviewForm.hidden = true;
      setCommitAction("save");
      setCommitStatus("Repas enregistré. Vérifie l’état de publication du site.", "info");
      setStatus("Repas photo enregistré.", "success");
    }
    await fetchCaptureHistory();
  } finally {
    elements.commitDraft.disabled = false;
  }
}

function bindEvents() {
  elements.photoInput?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] || null;
    setPreview(file);
    setStatus(file ? "Photo prête pour analyse." : "En attente d’une image.", file ? "info" : "neutral");
    if (elements.captureAutoNote) {
      elements.captureAutoNote.textContent = file
        ? "Photo chargée. Tu peux lancer l’analyse ou reprendre une autre image."
        : "Si la photo arrive depuis le menu Partager Android, l’analyse démarre automatiquement.";
    }
  });

  elements.analyzeButton?.addEventListener("click", () => {
    uploadPhoto({ auto: false }).catch((error) => {
      console.error(error);
      setStatus(error.message || "Analyse impossible.", "error");
    });
  });

  elements.addItem?.addEventListener("click", () => {
    elements.draftItems.appendChild(buildItemRow());
  });

  elements.draftItems?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="remove-item"]');
    if (!button) return;
    const row = button.closest(".capture-item-row");
    row?.remove();
    refreshDraftAssessmentPreview();
  });

  document.querySelector(".capture-quick-actions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quick-action]");
    if (!button) return;
    runQuickAction(button.dataset.quickAction);
  });

  elements.captureHistory?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-history-capture"]');
    if (!button) return;
    openHistoryCapture(button.dataset.captureId).catch((error) => {
      console.error(error);
      setStatus(error.message || "Impossible d’ouvrir cette capture.", "error");
    });
  });

  elements.reviewForm?.addEventListener("submit", (event) => {
    commitDraft(event).catch((error) => {
      console.error(error);
      setCommitStatus(error.message || "Commit impossible.", "error");
    });
  });

  elements.reviewForm?.addEventListener("input", (event) => {
    if (!event.target.closest("#draft-items, #draft-meal-type")) return;
    refreshDraftAssessmentPreview();
  });
}

async function init() {
  setupReveal();
  bindEvents();
  setCommitAction("save");
  setPreview(null);
  const authReady = window.__atlasAuthReady;
  if (authReady && typeof authReady.then === "function") {
    await authReady;
  }

  const shareError = getQueryParam("share_error");
  if (shareError) {
    setStatus("Aucune image n’a été reçue depuis le menu Partager.", "error");
  }

  const shareId = getQueryParam("share_id");
  if (shareId) {
    const loaded = await loadSharedFile(shareId);
    if (loaded) {
      setStatus("Photo reçue. L’analyse automatique démarre…", "info");
      await uploadPhoto({ auto: true });
    }
  }

  if (getQueryParam("capture_id")) {
    await refreshExistingCapture();
  }
  await fetchCaptureHistory();
}

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "Initialisation impossible.", "error");
});
