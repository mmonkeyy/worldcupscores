const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  || process.env.GOOGLE_API_KEY
  || process.env.GOOGLE_GENERATIVE_AI_API_KEY
  || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function health() {
  return {
    ok: true,
    dataSource: "gemini_search_grounding",
    geminiConfigured: Boolean(GEMINI_API_KEY),
    geminiModel: GEMINI_MODEL,
    time: new Date().toISOString()
  };
}

async function providerTest() {
  return geminiTest();
}

async function debugStatus() {
  const result = {
    dataSource: "gemini_search_grounding",
    geminiKeyConfigured: Boolean(GEMINI_API_KEY),
    geminiEnvNamesPresent: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]
      .filter((name) => Boolean(process.env[name])),
    geminiModel: GEMINI_MODEL,
    checkedAt: new Date().toISOString(),
    checks: []
  };

  if (!GEMINI_API_KEY) {
    result.checks.push({ name: "gemini_scores", error: "missing_gemini_key" });
    return result;
  }

  try {
    const matches = await geminiWorldCupMatches();
    result.checks.push({ name: "gemini_scores", count: matches.length });
  } catch (error) {
    result.checks.push({ name: "gemini_scores", error: error.message });
  }

  return result;
}

async function getMatches() {
  if (!GEMINI_API_KEY) return [];

  try {
    return await geminiWorldCupMatches();
  } catch (error) {
    console.warn(`Gemini score lookup failed: ${error.message}`);
    return [];
  }
}

async function getMatch(matchId) {
  const matches = await getMatches();
  return matches.find((match) => String(match.id) === String(matchId)) || null;
}

async function geminiTest() {
  if (!GEMINI_API_KEY) {
    return { ok: false, error: "missing_gemini_key" };
  }

  try {
    const matches = await geminiWorldCupMatches();
    return { ok: true, dataSource: "gemini_search_grounding", count: matches.length };
  } catch (error) {
    return {
      ok: false,
      dataSource: "gemini_search_grounding",
      error: "gemini_request_failed",
      message: error.message
    };
  }
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
  if (typeof fetch !== "function") {
    throw new Error("This Node version does not include fetch. Use Node 18 or newer.");
  }

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
      generationConfig: { temperature: 0.1 }
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
  const kickoff = validDate(match.kickoff) || new Date();
  const status = ["live", "finished", "upcoming"].includes(match.status) ? match.status : inferStatus(match);
  const homeScore = parseScore(match.home.score);
  const awayScore = parseScore(match.away.score);

  return {
    id: match.id || `gemini-${isoDate(kickoff)}-${index}`,
    source: "gemini",
    kickoff: kickoff.toISOString(),
    status,
    minute: parseMinute(match.minute),
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

function parseMinute(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stripCodeFence(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  debugStatus,
  getMatch,
  getMatches,
  health,
  providerTest
};
