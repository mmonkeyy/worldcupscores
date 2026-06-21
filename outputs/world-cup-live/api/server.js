const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.resolve(__dirname, "..");
const WORLD_CUP_LEAGUE_ID = process.env.WORLD_CUP_LEAGUE_ID || "1";
const WORLD_CUP_SEASON = process.env.WORLD_CUP_SEASON || "2026";
const PROVIDER_BASE = trimSlash(process.env.FOOTBALL_API_BASE || "https://v3.football.api-sports.io");
const PROVIDER_KEY = process.env.FOOTBALL_API_KEY || "";

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "OPTIONS") {
    sendCors(res, 204);
    res.end();
    return;
  }

  try {
    if (reqUrl.pathname.startsWith("/api/")) {
      await routeApi(req, res, reqUrl);
      return;
    }

    serveStatic(res, reqUrl.pathname);
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`World Cup API running at http://${HOST}:${PORT}`);
  console.log(`Website running at http://${HOST}:${PORT}/`);
});

async function routeApi(req, res, reqUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const parts = reqUrl.pathname.split("/").filter(Boolean);

  if (reqUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      provider: Boolean(PROVIDER_KEY),
      providerBase: PROVIDER_BASE,
      time: new Date().toISOString()
    });
    return;
  }

  if (reqUrl.pathname === "/api/provider-test") {
    if (!PROVIDER_KEY) {
      sendJson(res, 200, { ok: false, error: "missing_provider_key" });
      return;
    }

    try {
      const status = await providerGet("/status");
      sendJson(res, 200, { ok: true, providerBase: PROVIDER_BASE, status });
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        providerBase: PROVIDER_BASE,
        error: "provider_request_failed",
        message: error.message
      });
    }
    return;
  }

  if (reqUrl.pathname === "/api/matches") {
    sendJson(res, 200, { matches: await getMatches() });
    return;
  }

  if (reqUrl.pathname === "/api/matches/live") {
    const matches = await getMatches();
    sendJson(res, 200, { matches: matches.filter((match) => match.status === "live") });
    return;
  }

  if (parts[0] === "api" && parts[1] === "matches" && parts[2]) {
    const matchId = decodeURIComponent(parts[2]);
    const match = await getMatch(matchId);
    if (!match) {
      sendJson(res, 404, { error: "match_not_found" });
      return;
    }

    if (!parts[3]) {
      sendJson(res, 200, { match });
      return;
    }

    if (parts[3] === "stats") {
      sendJson(res, 200, { stats: match.stats || [] });
      return;
    }

    if (parts[3] === "lineups") {
      sendJson(res, 200, { lineups: match.lineups || { home: [], away: [] } });
      return;
    }

    if (parts[3] === "events") {
      sendJson(res, 200, { events: match.events || [] });
      return;
    }
  }

  sendJson(res, 404, { error: "not_found" });
}

async function getMatches() {
  if (PROVIDER_KEY) {
    try {
      const from = isoDate(addDays(new Date(), -2));
      const to = isoDate(addDays(new Date(), 7));
      const fixtures = await providerWorldCupFixtures(from, to);
      const matches = fixtures.map(mapProviderFixture).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      if (matches.length) return matches;
    } catch (error) {
      console.warn(`Provider fetch failed: ${error.message}`);
    }
  }

  return sampleMatches();
}

async function providerWorldCupFixtures(from, to) {
  const fixtures = [];
  const seen = new Set();
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (current <= end) {
    const data = await providerGet(`/fixtures?date=${isoDate(current)}`);
    for (const fixture of data.response || []) {
      const isWorldCup = String(fixture.league?.id) === String(WORLD_CUP_LEAGUE_ID)
        || fixture.league?.name === "World Cup";

      if (isWorldCup && !seen.has(fixture.fixture?.id)) {
        seen.add(fixture.fixture?.id);
        fixtures.push(fixture);
      }
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return fixtures;
}

async function getMatch(matchId) {
  const matches = await getMatches();
  const baseMatch = matches.find((match) => String(match.id) === String(matchId));
  if (!baseMatch) return null;

  if (!PROVIDER_KEY || String(matchId).startsWith("sample")) {
    return baseMatch;
  }

  try {
    const [stats, lineups, events] = await Promise.all([
      providerGet(`/fixtures/statistics?fixture=${encodeURIComponent(matchId)}`),
      providerGet(`/fixtures/lineups?fixture=${encodeURIComponent(matchId)}`),
      providerGet(`/fixtures/events?fixture=${encodeURIComponent(matchId)}`)
    ]);

    return {
      ...baseMatch,
      stats: mapProviderStats(stats.response, baseMatch),
      lineups: mapProviderLineups(lineups.response, baseMatch),
      events: mapProviderEvents(events.response)
    };
  } catch (error) {
    console.warn(`Provider detail fetch failed: ${error.message}`);
    return baseMatch;
  }
}

async function providerGet(route) {
  if (typeof fetch !== "function") {
    throw new Error("This Node version does not include fetch. Use Node 18 or newer.");
  }

  const response = await fetch(`${PROVIDER_BASE}${route}`, {
    headers: { "x-apisports-key": PROVIDER_KEY }
  });

  if (!response.ok) {
    throw new Error(`provider returned ${response.status}`);
  }

  return response.json();
}

function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${cleanPath}`);

  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    sendCors(res, 200, contentType(filePath));
    res.end(data);
  });
}

function sendJson(res, status, body) {
  sendCors(res, status, "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, text) {
  sendCors(res, status, "text/plain; charset=utf-8");
  res.end(text);
}

function sendCors(res, status, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": type
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function mapProviderFixture(item) {
  const short = item.fixture?.status?.short;
  const status = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short)
    ? "live"
    : ["FT", "AET", "PEN"].includes(short)
      ? "finished"
      : "upcoming";

  return {
    id: item.fixture.id,
    kickoff: item.fixture.date,
    status,
    minute: item.fixture?.status?.elapsed,
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

function mapProviderStats(response = [], match) {
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

function mapProviderLineups(response = [], match) {
  const home = response.find((item) => item.team?.name === match.home.name);
  const away = response.find((item) => item.team?.name === match.away.name);

  return {
    home: (home?.startXI || []).map((item) => item.player?.name).filter(Boolean),
    away: (away?.startXI || []).map((item) => item.player?.name).filter(Boolean)
  };
}

function mapProviderEvents(response = []) {
  return response.map((event) => ({
    time: `${event.time?.elapsed || ""}'`,
    text: `${event.team?.name || ""}: ${event.player?.name || ""} ${event.type || ""}${event.detail ? ` - ${event.detail}` : ""}`.trim()
  }));
}

function valueFor(stats, name) {
  const found = stats.find((item) => item.type === name);
  return found?.value ?? "0";
}

function sampleMatches() {
  const now = new Date();

  return [
    {
      id: "demo-live",
      source: "demo",
      kickoff: addMinutes(now, -54).toISOString(),
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
      kickoff: addHours(now, 2).toISOString(),
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
      kickoff: addHours(now, 26).toISOString(),
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

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}
