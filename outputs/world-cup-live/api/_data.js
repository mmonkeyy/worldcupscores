const WORLD_CUP_LEAGUE_ID = process.env.WORLD_CUP_LEAGUE_ID || "1";
const PROVIDER_BASE = trimSlash(process.env.FOOTBALL_API_BASE || "https://v3.football.api-sports.io");
const PROVIDER_KEY = process.env.FOOTBALL_API_KEY || "";

async function health() {
  return {
    ok: true,
    provider: Boolean(PROVIDER_KEY),
    providerBase: PROVIDER_BASE,
    time: new Date().toISOString()
  };
}

async function providerTest() {
  if (!PROVIDER_KEY) {
    return { ok: false, error: "missing_provider_key" };
  }

  try {
    const status = await providerGet("/status");
    return { ok: true, providerBase: PROVIDER_BASE, status };
  } catch (error) {
    return {
      ok: false,
      providerBase: PROVIDER_BASE,
      error: "provider_request_failed",
      message: error.message
    };
  }
}

async function getMatches() {
  if (PROVIDER_KEY) {
    try {
      const dates = datesAroundToday(-1, 3);
      const fixtures = await providerWorldCupFixtures(dates);
      const matches = fixtures.map(mapProviderFixture).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      if (matches.length) return matches;
    } catch (error) {
      console.warn(`Provider fetch failed: ${error.message}`);
    }
  }

  return sampleMatches();
}

async function getMatch(matchId) {
  const matches = await getMatches();
  const baseMatch = matches.find((match) => String(match.id) === String(matchId));
  if (!baseMatch) return null;

  if (!PROVIDER_KEY || String(matchId).startsWith("demo")) {
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

async function providerWorldCupFixtures(dates) {
  const fixtures = [];
  const seen = new Set();

  const responses = await Promise.all(dates.map((date) => providerGet(`/fixtures?date=${date}`)));
  for (const data of responses) {
    for (const fixture of data.response || []) {
      const isWorldCup = String(fixture.league?.id) === String(WORLD_CUP_LEAGUE_ID)
        || fixture.league?.name === "World Cup";

      if (isWorldCup && !seen.has(fixture.fixture?.id)) {
        seen.add(fixture.fixture?.id);
        fixtures.push(fixture);
      }
    }
  }

  return fixtures;
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

function datesAroundToday(daysBefore, daysAfter) {
  const today = new Date();
  const dates = [];

  for (let offset = daysBefore; offset <= daysAfter; offset += 1) {
    dates.push(isoDate(addDays(today, offset)));
  }

  return dates;
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

module.exports = {
  getMatch,
  getMatches,
  health,
  providerTest
};
