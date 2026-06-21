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
  matches: [],
  details: new Map(),
  loading: false
};

init();

function init() {
  localStorage.removeItem("wc-live-settings");
  bindEvents();
  refreshMatches();
  setInterval(() => render(), 1000);
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
  updateStatus("Refreshing scores...");
  render();

  try {
    state.matches = await fetchMatches();
    updateStatus(
      state.matches.length
        ? `Scores updated - ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Waiting for World Cup score feed"
    );
  } catch (error) {
    console.warn(error);
    state.matches = [];
    updateStatus("Score feed is temporarily unavailable");
  } finally {
    state.loading = false;
    if (!state.selectedId || !state.matches.some((match) => match.id === state.selectedId)) {
      state.selectedId = state.matches[0]?.id ?? null;
    }
    render();
    loadSelectedDetails();
  }
}

async function fetchMatches() {
  const payload = await apiGet("/matches");
  const matches = Array.isArray(payload) ? payload : payload.matches;
  return (matches || []).map(normalizeApiMatch).sort((a, b) => a.kickoff - b.kickoff);
}

async function loadSelectedDetails() {
  const match = state.matches.find((item) => item.id === state.selectedId);
  if (!match || state.details.has(match.id)) {
    render();
    return;
  }

  try {
    const detail = await apiGet(`/matches/${encodeURIComponent(match.id)}`);
    state.details.set(match.id, normalizeApiMatch(detail.match || detail));
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
    els.matchList.innerHTML = `<div class="empty">${state.loading ? "Loading matches..." : "No score feed data is available yet."}</div>`;
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
      <span class="scorebox">
        <span class="badge ${match.status === "live" ? "badge--live" : match.status === "upcoming" ? "badge--upcoming" : ""}">${statusLabel(match)}</span>
        <span class="score">${scoreLabel(match)}</span>
        <span class="countdown">${timeLabel(match)}</span>
      </span>
      <span class="team team--away">
        <span class="team__name">${escapeHtml(match.away.name)}</span>
        <span class="team__meta">${escapeHtml(match.venue)}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      state.selectedId = match.id;
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
    els.matchDetail.innerHTML = `<div class="detail__section">Matches will appear here when the score feed returns World Cup fixtures.</div>`;
    return;
  }

  const detail = state.details.get(match.id) || match;
  els.matchDetail.innerHTML = `
    <div class="detail__header">
      <p class="eyebrow">${escapeHtml(match.round)}</p>
      <h2 class="detail__title">${escapeHtml(match.home.name)} vs ${escapeHtml(match.away.name)}</h2>
      <div class="detail__meta">${formatDate(match.kickoff)}<br>${escapeHtml(match.venue)} - ${escapeHtml(match.city)}</div>
    </div>
    <section class="detail__section">
      <p class="eyebrow">Match stats</p>
      ${renderStats(detail.stats || match.stats)}
    </section>
    <section class="detail__section">
      <p class="eyebrow">Lineups</p>
      ${renderLineups(detail.lineups || match.lineups)}
    </section>
    <section class="detail__section">
      <p class="eyebrow">Events</p>
      <div class="events">${renderEvents(detail.events || match.events)}</div>
    </section>
  `;
}

function renderStats(stats) {
  if (!stats?.length) return `<div class="empty">Stats appear once the match feed provides them.</div>`;
  return stats.map((stat) => {
    const homeValue = Number.parseFloat(stat.home) || 0;
    const awayValue = Number.parseFloat(stat.away) || 0;
    const total = Math.max(homeValue + awayValue, 1);
    const pct = Math.round((homeValue / total) * 100);
    return `
      <div class="stat-row">
        <span>${escapeHtml(stat.home)}</span>
        <span>
          <span>${escapeHtml(stat.name)}</span>
          <span class="bar"><span style="width:${pct}%"></span></span>
        </span>
        <span>${escapeHtml(stat.away)}</span>
      </div>
    `;
  }).join("");
}

function renderLineups(lineups) {
  if (!lineups?.home?.length && !lineups?.away?.length) return `<div class="empty">Lineups are usually confirmed close to kickoff.</div>`;
  return `
    <div class="lineups">
      ${renderLineupColumn("Home", lineups.home)}
      ${renderLineupColumn("Away", lineups.away)}
    </div>
  `;
}

function renderLineupColumn(label, players = []) {
  return `
    <div class="lineup">
      <h3>${label}</h3>
      <ol>${players.slice(0, 11).map((player) => `<li>${escapeHtml(player)}</li>`).join("")}</ol>
    </div>
  `;
}

function renderEvents(events) {
  if (!events?.length) return `<div class="empty">Goals, cards, and substitutions will land here.</div>`;
  return events.map((event) => `
    <div class="event">
      <strong>${escapeHtml(event.time)}</strong>
      <span>${escapeHtml(event.text)}</span>
    </div>
  `).join("");
}

function filteredMatches() {
  return state.matches.filter((match) => {
    const haystack = `${match.home.name} ${match.away.name} ${match.venue} ${match.group} ${match.city}`.toLowerCase();
    const statusOk = state.filter === "all" || match.status === state.filter;
    return statusOk && (!state.query || haystack.includes(state.query));
  });
}

function statusLabel(match) {
  if (match.status === "live") return match.minute ? `${match.minute}' live` : "Live";
  if (match.status === "finished") return "Full time";
  return "Kickoff";
}

function scoreLabel(match) {
  if (match.status === "upcoming") return "vs";
  return `${match.home.score ?? 0} - ${match.away.score ?? 0}`;
}

function timeLabel(match) {
  if (match.status === "live") return "In progress";
  if (match.status === "finished") return "Final";
  const diff = match.kickoff - new Date();
  if (diff <= 0) return "Starting soon";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function normalizeApiMatch(match) {
  return {
    ...match,
    kickoff: new Date(match.kickoff)
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
