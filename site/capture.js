const SHARE_CACHE = "atlas-share-target-v1";
const SHARE_FILE_PREFIX = "/__share-target/";
const SHARE_META_PREFIX = "/__share-target-meta/";

const state = {
  file: null,
  previewUrl: "",
  draft: null,
  captureId: "",
  ticket: null,
  ticketExpiresAt: 0,
  captureApiBase: "",
};

const elements = {
  photoInput: document.getElementById("photo-input"),
  shareHint: document.getElementById("share-hint"),
  photoPreview: document.getElementById("photo-preview"),
  photoPreviewEmpty: document.getElementById("photo-preview-empty"),
  photoMeta: document.getElementById("photo-meta"),
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
  draftItems: document.getElementById("draft-items"),
  addItem: document.getElementById("add-item"),
  commitStatus: document.getElementById("commit-status"),
  commitDraft: document.getElementById("commit-draft"),
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
  const payload = await response.json();
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
    </div>
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
  elements.reviewSummary.textContent = draft.auto_commit_eligible
    ? "La photo était assez nette pour un auto-commit, mais tu peux encore ajuster ce brouillon."
    : "L’analyse a produit un brouillon à valider avant écriture.";
  elements.draftDate.value = draft.date || "";
  elements.draftTime.value = draft.time || "";
  elements.draftMealType.value = draft.meal_type || "snack";
  elements.draftConfidence.value = draft.confidence || "medium";
  elements.draftSourceText.value = draft.source_text || "";
  renderAssessment(draft);
  elements.draftItems.innerHTML = "";
  (draft.items || []).forEach((item) => {
    elements.draftItems.appendChild(buildItemRow(item));
  });
  if (!(draft.items || []).length) {
    elements.draftItems.appendChild(buildItemRow());
  }
}

function serializeDraft() {
  const itemRows = Array.from(elements.draftItems.querySelectorAll(".capture-item-row"));
  const items = itemRows.map((row) => {
    const quantityValue = row.querySelector('[data-field="quantity"]').value;
    return {
      label: row.querySelector('[data-field="label"]').value.trim(),
      quantity: quantityValue === "" ? null : Number(quantityValue),
      unit: row.querySelector('[data-field="unit"]').value,
      portion_text: row.querySelector('[data-field="portion_text"]').value.trim(),
      notes: row.querySelector('[data-field="notes"]').value.trim(),
    };
  }).filter((item) => item.label);

  return {
    ...state.draft,
    date: elements.draftDate.value,
    time: elements.draftTime.value,
    meal_type: elements.draftMealType.value,
    confidence: elements.draftConfidence.value,
    source_text: elements.draftSourceText.value.trim(),
    items,
  };
}

async function uploadPhoto() {
  if (!state.file) {
    setStatus("Choisis d’abord une photo.", "error");
    return;
  }
  const ticket = await getTicket(true);
  setStatus("Analyse de la photo en cours…", "info");
  elements.analyzeButton.disabled = true;

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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Upload refusé (${response.status}).`);

    state.captureId = payload.captureId || "";
    updateUrl({ capture_id: state.captureId, share_id: "" });
    renderAnalysisSummary(payload);

    if (payload.captureId && payload.status === "committed") {
      setStatus("Repas enregistré et site mis à jour.", "success");
      setCommitStatus("Le repas a été ajouté automatiquement.", "success");
      elements.reviewForm.hidden = true;
    } else {
      setStatus("Brouillon généré. Vérifie les aliments avant enregistrement.", "info");
      setCommitStatus("Le brouillon peut être ajusté puis enregistré.", "info");
      renderDraftForm(payload.draft || {});
    }

    const shareId = getQueryParam("share_id");
    if (shareId) await cleanupSharedFile(shareId);
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
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Chargement capture impossible (${response.status}).`);
  state.captureId = payload.captureId || captureId;
  renderAnalysisSummary(payload);
  if (payload.status === "committed") {
    elements.reviewForm.hidden = true;
    setStatus("Cette capture est déjà enregistrée.", "success");
    setCommitStatus("Le repas a déjà été écrit dans les imports privés.", "success");
    return;
  }
  renderDraftForm(payload.draft || {});
  setStatus("Brouillon rechargé.", "info");
}

async function commitDraft(event) {
  event.preventDefault();
  if (!state.captureId) {
    setCommitStatus("Aucune capture active à enregistrer.", "error");
    return;
  }
  const ticket = await getTicket(true);
  setCommitStatus("Écriture du repas et rebuild du site en cours…", "info");
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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Commit refusé (${response.status}).`);
    renderAnalysisSummary(payload);
    elements.reviewForm.hidden = true;
    setCommitStatus("Repas enregistré. Le dashboard a été régénéré.", "success");
    setStatus("Repas photo enregistré avec succès.", "success");
  } finally {
    elements.commitDraft.disabled = false;
  }
}

function bindEvents() {
  elements.photoInput?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0] || null;
    setPreview(file);
    setStatus(file ? "Photo prête pour analyse." : "En attente d’une image.", file ? "info" : "neutral");
  });

  elements.analyzeButton?.addEventListener("click", () => {
    uploadPhoto().catch((error) => {
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
  });

  elements.reviewForm?.addEventListener("submit", (event) => {
    commitDraft(event).catch((error) => {
      console.error(error);
      setCommitStatus(error.message || "Commit impossible.", "error");
    });
  });
}

async function init() {
  bindEvents();
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
      setStatus("Photo reçue. Lance l’analyse quand tu veux.", "info");
    }
  }

  if (getQueryParam("capture_id")) {
    await refreshExistingCapture();
  }
}

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "Initialisation impossible.", "error");
});
