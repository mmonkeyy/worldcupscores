const API_BASE = "/api";

const els = {
  matchList: document.querySelector("#matchList"),
  matchDetail: document.querySelector("#matchDetail"),
  dataStatus: document.querySelector("#dataStatus"),
  refreshBtn: document.querySelector("#refreshBtn"),
  searchInput: document.querySelector("#searchInput"),
  filterButtons: [...document.querySelectorAll("[data-filter]")]
};

let state = {
  filter: "all",
  query: "",
  selectedId: null,
  selectedClipId: null,
  matches: [],
  details: new Map(),
  feedMeta: null,
  loading: false
};

init();

function init() {
  bindEvents();
  refreshMatches();
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshMatches);
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });
  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filterButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
        item.setAttribute("aria-selected", String(item === button));
      });
      render();
    });
  });
}

async function refreshMatches() {
  state.loading = true;
  updateStatus("Loading goal replays...");
  render();

  try {
    const payload = await fetchMatches();
    state.matches = payload.matches;
    state.feedMeta = payload.meta;
    updateStatus(
      state.matches.length
        ? `Highlights updated - ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : emptyStatusLabel()
    );
  } catch (error) {
    console.warn(error);
    state.matches = [];
    state.feedMeta = {
      lastError: error.message,
      setupHint: "The highlight API request failed before the feed could be checked."
    };
    updateStatus("Highlight feed is temporarily unavailable");
  } finally {
    state.loading = false;
    if (!state.selectedId || !state.matches.some((match) => match.id === state.selectedId)) {
      state.selectedId = state.matches[0]?.id ?? null;
      state.selectedClipId = state.matches[0]?.videos?.[0]?.id ?? null;
    }
    render();
    loadSelectedDetails();
  }
}

async function fetchMatches() {
  const payload = await apiGet("/matches");
  const matches = Array.isArray(payload) ? payload : payload.matches;
  return {
    matches: (matches || []).map(normalizeApiMatch),
    meta: payload.meta || null
  };
}

async function loadSelectedDetails() {
  const match = state.matches.find((item) => item.id === state.selectedId);
  if (!match || state.details.has(match.id)) {
    ensureSelectedClip(match);
    render();
    return;
  }

  try {
    const detail = await apiGet(`/matches/${encodeURIComponent(match.id)}`);
    state.details.set(match.id, normalizeApiMatch(detail.match || detail));
    ensureSelectedClip(state.details.get(match.id));
  } catch (error) {
    console.warn(error);
  }
  render();
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}

function render() {
  const matches = filteredMatches();
  renderMatchList(matches);
  renderDetail();
}

function renderMatchList(matches) {
  els.matchList.innerHTML = "";
  if (!matches.length) {
    els.matchList.innerHTML = renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  matches.forEach((match) => {
    const button = document.createElement("button");
    button.className = `match-card ${match.id === state.selectedId ? "is-selected" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="team">
        <span class="team__name">${escapeHtml(match.home.name)}</span>
        <span class="team__meta">${escapeHtml(match.group)}</span>
      </span>
      <span class="scorebox" aria-label="Open replays">
        <span class="badge badge--replay">${escapeHtml(statusLabel(match))}</span>
        <span class="score">${escapeHtml(scoreLabel(match))}</span>
        <span class="countdown">Pick a replay</span>
      </span>
      <span class="team team--away">
        <span class="team__name">${escapeHtml(match.away.name)}</span>
        <span class="team__meta">${formatDate(match.kickoff)}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      state.selectedId = match.id;
      state.selectedClipId = match.videos?.[0]?.id ?? null;
      render();
      loadSelectedDetails();
    });
    fragment.append(button);
  });
  els.matchList.append(fragment);
}

function renderDetail() {
  const match = state.matches.find((item) => item.id === state.selectedId) || filteredMatches()[0];
  if (!match) {
    els.matchDetail.innerHTML = renderDetailEmptyState();
    return;
  }

  const detail = state.details.get(match.id) || match;
  ensureSelectedClip(detail);
  const clip = selectedClip(detail);
  els.matchDetail.innerHTML = `
    <div class="detail__header">
      <p class="eyebrow">${escapeHtml(detail.round)}</p>
      <h2 class="detail__title">${escapeHtml(detail.home.name)} vs ${escapeHtml(detail.away.name)}</h2>
      <div class="detail__meta">${formatDate(detail.kickoff)}<br>${escapeHtml(detail.group)}</div>
    </div>
    <section class="video-player" aria-label="Selected replay">
      ${renderVideo(clip)}
    </section>
    <section class="detail__section">
      <p class="eyebrow">Goals and replays</p>
      <div class="clip-list">${renderClips(detail)}</div>
    </section>
  `;

  els.matchDetail.querySelectorAll("[data-clip-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClipId = button.dataset.clipId;
      renderDetail();
    });
  });
}

function renderVideo(clip) {
  if (!clip) {
    return `<div class="video-empty">Choose a match to load replay clips.</div>`;
  }

  if (clip.embedUrl) {
    return `
      <div class="video-shell">
        <iframe
          src="${escapeAttribute(clip.embedUrl)}"
          title="${escapeAttribute(clip.title)}"
          loading="lazy"
          referrerpolicy="origin"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowfullscreen>
        </iframe>
      </div>
    `;
  }

  return `<div class="video-empty">This replay does not include an embeddable video.</div>`;
}

function renderClips(match) {
  if (!match.videos?.length) return `<div class="empty">No replay clips are attached to this match yet.</div>`;
  return match.videos.map((clip, index) => `
    <button class="clip-button ${clip.id === state.selectedClipId ? "is-active" : ""}" type="button" data-clip-id="${escapeAttribute(clip.id)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(clip.title)}</strong>
    </button>
  `).join("");
}

function filteredMatches() {
  return state.matches.filter((match) => {
    const haystack = `${match.home.name} ${match.away.name} ${match.group} ${match.round}`.toLowerCase();
    const clipTitles = (match.videos || []).map((clip) => clip.title).join(" ").toLowerCase();
    const filterOk = state.filter === "all"
      || (state.filter === "goals" && match.videos.some((clip) => /goal|penalty/i.test(clip.title)))
      || (state.filter === "highlights" && match.videos.some((clip) => /highlight/i.test(clip.title)))
      || (state.filter === "latest");
    return filterOk && (!state.query || `${haystack} ${clipTitles}`.includes(state.query));
  });
}

function renderEmptyState() {
  if (state.loading) return `<div class="empty">Loading highlights...</div>`;

  const meta = state.feedMeta || {};
  const title = meta.lastError ? "Highlight feed is blocked" : "No replay clips loaded";
  const detail = meta.lastError
    ? meta.lastError
    : meta.setupHint || "Add a highlight feed token or custom feed URL in Vercel.";

  return `
    <div class="empty empty--diagnostic">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
      <code>/api/debug</code>
    </div>
  `;
}

function renderDetailEmptyState() {
  const meta = state.feedMeta || {};
  return `
    <div class="detail__section empty--diagnostic">
      <strong>Replay source needs data</strong>
      <span>${escapeHtml(meta.setupHint || "Set SCOREBAT_TOKEN or SCOREBAT_FEED_URL in Vercel, then redeploy.")}</span>
    </div>
  `;
}

function emptyStatusLabel() {
  if (state.feedMeta?.lastError) return "Highlight feed blocked";
  if (state.feedMeta?.configured) return "Highlight feed returned no clips";
  return "Connect highlight feed";
}

function ensureSelectedClip(match) {
  if (!match?.videos?.length) {
    state.selectedClipId = null;
    return;
  }

  if (!state.selectedClipId || !match.videos.some((clip) => clip.id === state.selectedClipId)) {
    state.selectedClipId = match.videos[0].id;
  }
}

function selectedClip(match) {
  return match?.videos?.find((clip) => clip.id === state.selectedClipId) || match?.videos?.[0] || null;
}

function statusLabel(match) {
  return match.videos?.some((clip) => /goal|penalty/i.test(clip.title)) ? "Goals" : "Replay";
}

function scoreLabel(match) {
  return match.scoreLabel || `${match.videos?.length || 0} clips`;
}

function normalizeApiMatch(match) {
  return {
    ...match,
    kickoff: new Date(match.kickoff),
    videos: Array.isArray(match.videos) ? match.videos : []
  };
}

function updateStatus(message) {
  els.dataStatus.textContent = message;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
