const STORAGE_KEY = "wc-live-settings";
const LOCAL_API_BASE = "http://127.0.0.1:8787/api";
const WORLD_CUP_LEAGUE_ID = 1;
const WORLD_CUP_SEASON = 2026;

const els = {
  matchList: document.querySelector("#matchList"),
  matchDetail: document.querySelector("#matchDetail"),
  dataStatus: document.querySelector("#dataStatus"),
  refreshBtn: document.querySelector("#refreshBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsDialog: document.querySelector("#settingsDialog"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  apiBaseInput: document.querySelector("#apiBaseInput"),
  sampleModeInput: document.querySelector("#sampleModeInput"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  clearSettingsBtn: document.querySelector("#clearSettingsBtn"),
  searchInput: document.querySelector("#searchInput"),
  filterButtons: [...document.querySelectorAll("[data-filter]")]
};

let settings = loadSettings();
let state = {
  filter: "all",
  query: "",
  selectedId: null,
  matches: [],
  details: new Map(),
  loading: false
};

const sampleMatches = createSampleMatches();

init();

function init() {
  hydrateSettingsForm();
  bindEvents();
  refreshMatches();
  setInterval(() => render(), 1000);
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshMatches);
  els.settingsBtn.addEventListener("click", () => els.settingsDialog.showModal());
  els.clearSettingsBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    settings = loadSettings();
    hydrateSettingsForm();
    refreshMatches();
  });
  els.saveSettingsBtn.addEventListener("click", () => {
    settings = {
      apiKey: els.apiKeyInput.value.trim(),
      apiBase: trimSlash(els.apiBaseInput.value.trim() || LOCAL_API_BASE),
      sampleOnly: els.sampleModeInput.checked
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    refreshMatches();
  });
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
  updateStatus("Refreshing matches...");
  render();

  try {
    if (!settings.sampleOnly) {
      const health = usesLocalApi() ? await apiGet("/health") : { provider: true };
      state.matches = await fetchLiveMatches();
      updateStatus(
        health.provider
          ? `Live provider connected - ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "Demo mode - no live score provider connected"
      );
    } else {
      state.matches = sampleMatches;
      updateStatus("Sample mode forced");
    }
  } catch (error) {
    console.warn(error);
    state.matches = sampleMatches;
    updateStatus("Your API is offline - showing sample data");
  } finally {
    state.loading = false;
    if (!state.selectedId || !state.matches.some((match) => match.id === state.selectedId)) {
      state.selectedId = state.matches[0]?.id ?? null;
    }
    render();
    loadSelectedDetails();
  }
}

async function fetchLiveMatches() {
  if (usesLocalApi()) {
    const payload = await apiGet("/matches");
    const matches = Array.isArray(payload) ? payload : payload.matches;
    return (matches || []).map(normalizeApiMatch).sort((a, b) => a.kickoff - b.kickoff);
  }

  const today = new Date();
  const from = isoDate(addDays(today, -2));
  const to = isoDate(addDays(today, 7));
  const payload = await apiGet(`/fixtures?league=${WORLD_CUP_LEAGUE_ID}&season=${WORLD_CUP_SEASON}&from=${from}&to=${to}`);
  const matches = (payload.response || []).map(mapFixture).sort((a, b) => a.kickoff - b.kickoff);
  return matches.length ? matches : sampleMatches;
}

async function loadSelectedDetails() {
  const match = state.matches.find((item) => item.id === state.selectedId);
  if (!match || state.details.has(match.id) || settings.sampleOnly || String(match.id).startsWith("sample")) {
    render();
    return;
  }

  try {
    if (usesLocalApi()) {
      const detail = await apiGet(`/matches/${encodeURIComponent(match.id)}`);
      state.details.set(match.id, normalizeApiMatch(detail.match || detail));
      render();
      return;
    }

    if (!settings.apiKey) {
      render();
      return;
    }

    const [stats, lineups, events] = await Promise.all([
      apiGet(`/fixtures/statistics?fixture=${match.id}`),
      apiGet(`/fixtures/lineups?fixture=${match.id}`),
      apiGet(`/fixtures/events?fixture=${match.id}`)
    ]);
    state.details.set(match.id, {
      stats: mapStats(stats.response, match),
      lineups: mapLineups(lineups.response, match),
      events: mapEvents(events.response)
    });
  } catch (error) {
    console.warn(error);
  }
  render();
}

async function apiGet(path) {
  const headers = usesLocalApi() ? {} : { "x-apisports-key": settings.apiKey };
  const response = await fetch(`${settings.apiBase}${path}`, { headers });
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
    els.matchList.innerHTML = `<div class="empty">No matches match that view.</div>`;
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
    els.matchDetail.innerHTML = `<div class="detail__section">Choose a match.</div>`;
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

function mapFixture(item) {
  const elapsed = item.fixture?.status?.elapsed;
  const short = item.fixture?.status?.short;
  const kickoff = new Date(item.fixture.date);
  const status = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short) ? "live" : ["FT", "AET", "PEN"].includes(short) ? "finished" : "upcoming";
  return {
    id: item.fixture.id,
    kickoff,
    status,
    minute: elapsed,
    group: item.league?.round || "World Cup",
    round: item.league?.round || "Fixture",
    venue: item.fixture?.venue?.name || "Venue TBC",
    city: item.fixture?.venue?.city || "City TBC",
    home: { name: item.teams?.home?.name || "Home", score: item.goals?.home },
    away: { name: item.teams?.away?.name || "Away", score: item.goals?.away },
    stats: [],
    lineups: { home: [], away: [] },
    events: []
  };
}

function mapStats(response = [], match) {
  const byTeam = new Map(response.map((team) => [team.team?.name, team.statistics || []]));
  const homeStats = byTeam.get(match.home.name) || [];
  const awayStats = byTeam.get(match.away.name) || [];
  const names = ["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls"];
  return names.map((name) => ({
    name,
    home: valueFor(homeStats, name),
    away: valueFor(awayStats, name)
  }));
}

function mapLineups(response = [], match) {
  const home = response.find((item) => item.team?.name === match.home.name);
  const away = response.find((item) => item.team?.name === match.away.name);
  return {
    home: (home?.startXI || []).map((item) => item.player?.name).filter(Boolean),
    away: (away?.startXI || []).map((item) => item.player?.name).filter(Boolean)
  };
}

function mapEvents(response = []) {
  return response.map((event) => ({
    time: `${event.time?.elapsed || ""}'`,
    text: `${event.team?.name || ""}: ${event.player?.name || ""} ${event.type || ""}${event.detail ? ` - ${event.detail}` : ""}`.trim()
  }));
}

function valueFor(stats, name) {
  const found = stats.find((item) => item.type === name);
  return found?.value ?? "0";
}

function statusLabel(match) {
  if (match.source === "demo" || String(match.id).startsWith("sample") || String(match.id).startsWith("demo")) return "Demo";
  if (match.status === "live") return match.minute ? `${match.minute}' live` : "Live";
  if (match.status === "finished") return "Full time";
  return "Kickoff";
}

function scoreLabel(match) {
  if (match.source === "demo" || String(match.id).startsWith("sample") || String(match.id).startsWith("demo")) return "not live";
  if (match.status === "upcoming") return "vs";
  return `${match.home.score ?? 0} - ${match.away.score ?? 0}`;
}

function timeLabel(match) {
  if (match.source === "demo" || String(match.id).startsWith("sample") || String(match.id).startsWith("demo")) return "Connect provider for real scores";
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

function createSampleMatches() {
  const now = new Date();
  return [
    {
      id: "demo-live",
      source: "demo",
      kickoff: addMinutes(now, -54),
      status: "upcoming",
      minute: null,
      group: "Demo data",
      round: "No real provider connected",
      venue: "Demo Stadium",
      city: "Demo City",
      home: { name: "Demo Team A", score: null },
      away: { name: "Demo Team B", score: null },
      stats: [],
      lineups: { home: [], away: [] },
      events: []
    },
    {
      id: "demo-next",
      source: "demo",
      kickoff: addHours(now, 2),
      status: "upcoming",
      minute: null,
      group: "Demo data",
      round: "No real provider connected",
      venue: "Demo Stadium",
      city: "Demo City",
      home: { name: "Demo Team C", score: null },
      away: { name: "Demo Team D", score: null },
      stats: [],
      lineups: { home: [], away: [] },
      events: []
    },
    {
      id: "demo-later",
      source: "demo",
      kickoff: addHours(now, 26),
      status: "upcoming",
      minute: null,
      group: "Demo data",
      round: "No real provider connected",
      venue: "Demo Stadium",
      city: "Demo City",
      home: { name: "Demo Team E", score: null },
      away: { name: "Demo Team F", score: null },
      stats: [],
      lineups: { home: [], away: [] },
      events: []
    }
  ];
}

function hydrateSettingsForm() {
  els.apiKeyInput.value = settings.apiKey;
  els.apiBaseInput.value = settings.apiBase;
  els.sampleModeInput.checked = settings.sampleOnly;
}

function loadSettings() {
  try {
    return {
      apiKey: "",
      apiBase: LOCAL_API_BASE,
      sampleOnly: false,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")
    };
  } catch {
    return { apiKey: "", apiBase: LOCAL_API_BASE, sampleOnly: false };
  }
}

function normalizeApiMatch(match) {
  return {
    ...match,
    kickoff: new Date(match.kickoff)
  };
}

function usesLocalApi() {
  return !settings.apiBase.includes("api-sports.io");
}

function updateStatus(message) {
  els.dataStatus.textContent = message;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
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

function trimSlash(value) {
  return value.replace(/\/+$/, "");
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
