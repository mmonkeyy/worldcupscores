const WORLD_CUP_LEAGUE_ID = process.env.WORLD_CUP_LEAGUE_ID || "1";
const PROVIDER_BASE = trimSlash(process.env.FOOTBALL_API_BASE || "https://v3.football.api-sports.io");
const PROVIDER_KEY = process.env.FOOTBALL_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  || process.env.GOOGLE_API_KEY
  || process.env.GOOGLE_GENERATIVE_AI_API_KEY
  || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function health() {
  return {
    ok: true,
    provider: Boolean(PROVIDER_KEY),
    geminiFallback: Boolean(GEMINI_API_KEY),
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

async function debugStatus() {
  const result = {
    providerKeyConfigured: Boolean(PROVIDER_KEY),
    geminiKeyConfigured: Boolean(GEMINI_API_KEY),
    geminiEnvNamesPresent: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]
      .filter((name) => Boolean(process.env[name])),
    providerBase: PROVIDER_BASE,
    leagueId: WORLD_CUP_LEAGUE_ID,
    checkedAt: new Date().toISOString(),
    checks: []
  };

  if (PROVIDER_KEY) {
    try {
      const fixtures = await providerWorldCupFixtures();
      result.checks.push({ name: "match_feed", count: fixtures.length });
    } catch (error) {
      result.checks.push({ name: "match_feed", error: error.message });
    }
  }

  if (GEMINI_API_KEY) {
    try {
      const matches = await geminiWorldCupMatches();
      result.checks.push({ name: "gemini_fallback", count: matches.length });
    } catch (error) {
      result.checks.push({ name: "gemini_fallback", error: error.message });
    }
  }

  return result;
}

async function getMatches() {
  if (PROVIDER_KEY) {
    try {
      const fixtures = await providerWorldCupFixtures();
      const matches = fixtures.map(mapProviderFixture).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
      if (matches.length) return matches;
    } catch (error) {
      console.warn(`Provider fetch failed: ${error.message}`);
    }
  }

  if (GEMINI_API_KEY) {
    try {
      const matches = await geminiWorldCupMatches();
      if (matches.length) return matches;
    } catch (error) {
      console.warn(`Gemini fallback failed: ${error.message}`);
    }
  }

  return sampleMatches();
}

async function getMatch(matchId) {
  const matches = await getMatches();
  const baseMatch = matches.find((match) => String(match.id) === String(matchId));
  if (!baseMatch) return null;

  if (!PROVIDER_KEY || String(matchId).startsWith("demo") || baseMatch.source === "gemini") {
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

async function providerWorldCupFixtures() {
  return providerWorldCupFixturesByDate(isoDate(new Date()));
}

async function providerWorldCupFixturesByDate(date) {
  const fixtures = [];
  const seen = new Set();

  const data = await providerGet(`/fixtures?date=${date}`);
  for (const fixture of data.response || []) {
    const isWorldCup = String(fixture.league?.id) === String(WORLD_CUP_LEAGUE_ID)
      || fixture.league?.name === "World Cup";

    if (isWorldCup && !seen.has(fixture.fixture?.id)) {
      seen.add(fixture.fixture?.id);
      fixtures.push(fixture);
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

  const data = await response.json();
  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(`provider error: ${Object.values(data.errors).join(" ")}`);
  }

  return data;
}

async function geminiWorldCupMatches() {
  const today = isoDate(new Date());
  const prompt = [
    `Today is ${today}.`,
    "Search the web for FIFA World Cup 2026 men's tournament fixtures and scores for today.",
    "Use sources such as FIFA match pages, Google sports results, or reputable live-score pages.",
    "Use Google Search grounding. Return only valid JSON with this exact shape:",
    '{"matches":[{"id":"string","kickoff":"ISO date string or null","status":"live|finished|upcoming","minute":number|null,"group":"string","round":"string","venue":"string","city":"string","home":{"name":"string","score":number|null},"away":{"name":"string","score":number|null},"events":[]}]}',
    "For finished or live matches, home.score and away.score must be numbers. For upcoming matches, scores must be null.",
    "Include only matches you can verify from search results. If no verified World Cup matches are found, return {\"matches\":[]}."
  ].join(" ");

  const data = await geminiGenerateJson(prompt);
  const matches = Array.isArray(data.matches) ? data.matches : [];

  return matches
    .filter((match) => match?.home?.name && match?.away?.name)
    .map((match, index) => normalizeGeminiMatch(match, index));
}

async function geminiGenerateJson(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Gemini returned ${response.status}: ${message.slice(0, 240)}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!text.trim()) throw new Error("Gemini returned an empty response");

  try {
    return JSON.parse(stripCodeFence(text));
  } catch (error) {
    throw new Error(`Gemini returned non-JSON content: ${text.slice(0, 240)}`);
  }
}

function normalizeGeminiMatch(match, index) {
  const kickoff = match.kickoff ? new Date(match.kickoff) : new Date();
  const status = ["live", "finished", "upcoming"].includes(match.status) ? match.status : inferStatus(match);
  const homeScore = parseScore(match.home.score);
  const awayScore = parseScore(match.away.score);

  return {
    id: match.id || `gemini-${isoDate(kickoff)}-${index}`,
    source: "gemini",
    kickoff: kickoff.toISOString(),
    status,
    minute: Number.isFinite(match.minute) ? match.minute : null,
    group: match.group || "World Cup",
    round: match.round || "World Cup",
    venue: match.venue || "Venue TBC",
    city: match.city || "City TBC",
    home: {
      name: match.home.name,
      score: homeScore
    },
    away: {
      name: match.away.name,
      score: awayScore
    },
    stats: [],
    lineups: { home: [], away: [] },
    events: Array.isArray(match.events) ? match.events : []
  };
}

function inferStatus(match) {
  if (parseScore(match.home?.score) !== null && parseScore(match.away?.score) !== null) return "finished";
  return "upcoming";
}

function parseScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stripCodeFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
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
  return [];
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

module.exports = {
  debugStatus,
  getMatch,
  getMatches,
  health,
  providerTest
};
