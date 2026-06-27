const SCOREBAT_FEATURED_URL = "https://www.scorebat.com/video-api/v3/featured-feed/";
const SCOREBAT_TOKEN = process.env.SCOREBAT_TOKEN || process.env.SCOREBAT_API_KEY || "";
const SCOREBAT_FEED_URL = process.env.SCOREBAT_FEED_URL
  || (SCOREBAT_TOKEN
    ? `https://www.scorebat.com/video-api/v3/feed/?token=${encodeURIComponent(SCOREBAT_TOKEN)}`
    : SCOREBAT_FEATURED_URL);
const HIGHLIGHT_CACHE_MS = Number(process.env.HIGHLIGHT_CACHE_MS || 10 * 60 * 1000);
const HIGHLIGHT_FETCH_TIMEOUT_MS = Number(process.env.HIGHLIGHT_FETCH_TIMEOUT_MS || 8000);

let matchCache = {
  expiresAt: 0,
  matches: [],
  lastError: null,
  lastCheckedAt: null
};

async function health() {
  return {
    ok: true,
    dataSource: "scorebat_highlights",
    scorebatConfigured: Boolean(SCOREBAT_TOKEN || process.env.SCOREBAT_FEED_URL),
    feedUrl: publicFeedName(),
    cachedMatches: matchCache.matches.length,
    lastError: matchCache.lastError,
    time: new Date().toISOString()
  };
}

async function providerTest() {
  try {
    const matches = await fetchHighlightMatches();
    return {
      ok: true,
      dataSource: "scorebat_highlights",
      feedUrl: publicFeedName(),
      count: matches.length
    };
  } catch (error) {
    return {
      ok: false,
      dataSource: "scorebat_highlights",
      feedUrl: publicFeedName(),
      error: "highlight_feed_failed",
      message: error.message
    };
  }
}

async function debugStatus() {
  const result = {
    dataSource: "scorebat_highlights",
    scorebatTokenConfigured: Boolean(SCOREBAT_TOKEN),
    customFeedConfigured: Boolean(process.env.SCOREBAT_FEED_URL),
    envNamesPresent: ["SCOREBAT_TOKEN", "SCOREBAT_API_KEY", "SCOREBAT_FEED_URL"]
      .filter((name) => Boolean(process.env[name])),
    feedUrl: publicFeedName(),
    cachedMatches: matchCache.matches.length,
    lastError: matchCache.lastError,
    checkedAt: new Date().toISOString(),
    checks: []
  };

  try {
    const matches = await fetchHighlightMatches();
    result.checks.push({ name: "highlight_feed", count: matches.length });
  } catch (error) {
    result.checks.push({ name: "highlight_feed", error: error.message });
  }

  return result;
}

async function getMatches() {
  if (matchCache.expiresAt > Date.now()) {
    return matchCache.matches;
  }

  try {
    const matches = await fetchHighlightMatches();
    matchCache = {
      expiresAt: Date.now() + HIGHLIGHT_CACHE_MS,
      matches,
      lastError: null,
      lastCheckedAt: new Date().toISOString()
    };
    return matches;
  } catch (error) {
    matchCache.lastError = error.message;
    matchCache.lastCheckedAt = new Date().toISOString();
    console.warn(`Highlight feed lookup failed: ${error.message}`);
    return matchCache.matches;
  }
}

async function getMatchBundle() {
  const matches = await getMatches();
  return {
    matches,
    meta: sourceMeta(matches)
  };
}

async function getMatch(matchId) {
  const matches = await getMatches();
  return matches.find((match) => String(match.id) === String(matchId)) || null;
}

async function fetchHighlightMatches() {
  if (typeof fetch !== "function") {
    throw new Error("This Node version does not include fetch. Use Node 18 or newer.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HIGHLIGHT_FETCH_TIMEOUT_MS);

  const response = await fetch(SCOREBAT_FEED_URL, {
    signal: controller.signal,
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "worldcupscores-highlight-browser/1.0"
    }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Highlight feed returned ${response.status}: ${message.slice(0, 180) || response.statusText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.response) ? payload.response : Array.isArray(payload) ? payload : [];
  return rows
    .map(normalizeHighlightMatch)
    .filter((match) => match.home.name && match.away.name && match.videos.length)
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));
}

function normalizeHighlightMatch(item, index) {
  const title = cleanText(item?.title || `Highlight match ${index + 1}`);
  const teams = splitTeams(title);
  const kickoff = validDate(item?.date) || new Date();
  const videos = normalizeVideos(item, title);
  const competition = typeof item?.competition === "object"
    ? item.competition?.name
    : item?.competition;

  return {
    id: item?.matchviewUrl ? slugify(item.matchviewUrl) : slugify(`${title}-${kickoff.toISOString()}-${index}`),
    source: "scorebat",
    sourceUrl: item?.matchviewUrl || "",
    thumbnail: item?.thumbnail || videos[0]?.thumbnail || "",
    kickoff: kickoff.toISOString(),
    status: "finished",
    minute: null,
    group: cleanText(competition || "Football highlights"),
    round: "Goal highlights",
    venue: "Replay clips",
    city: "Watch goals and highlights",
    home: {
      name: teams.home,
      score: null
    },
    away: {
      name: teams.away,
      score: null
    },
    scoreLabel: `${videos.length} clip${videos.length === 1 ? "" : "s"}`,
    stats: [],
    lineups: { home: [], away: [] },
    events: videos.map((video, videoIndex) => ({
      time: videoIndex === 0 ? "FT" : `${videoIndex + 1}`,
      text: video.title,
      clipId: video.id
    })),
    videos
  };
}

function normalizeVideos(item, title) {
  const videos = Array.isArray(item?.videos) ? item.videos : [];
  return videos.map((video, index) => {
    const videoTitle = cleanText(video?.title || `${title} clip ${index + 1}`);
    const embed = String(video?.embed || "");
    return {
      id: slugify(`${title}-${videoTitle}-${index}`),
      title: videoTitle,
      embed,
      embedUrl: extractIframeSrc(embed),
      thumbnail: video?.thumbnail || item?.thumbnail || "",
      sourceUrl: video?.url || item?.matchviewUrl || ""
    };
  }).filter((video) => video.embedUrl || video.sourceUrl || video.embed);
}

function splitTeams(title) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const separators = [" - ", " vs ", " v ", " Vs ", " VS "];
  const separator = separators.find((item) => normalized.includes(item));
  if (!separator) {
    return { home: normalized, away: "Highlights" };
  }

  const [home, ...rest] = normalized.split(separator);
  return {
    home: cleanText(home),
    away: cleanText(rest.join(separator))
  };
}

function extractIframeSrc(embed) {
  const match = String(embed || "").match(/\bsrc=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "highlight";
}

function publicFeedName() {
  if (process.env.SCOREBAT_FEED_URL) return "custom_SCOREBAT_FEED_URL";
  return SCOREBAT_TOKEN ? "scorebat_token_feed" : "scorebat_featured_feed";
}

function sourceMeta(matches = matchCache.matches) {
  const configured = Boolean(SCOREBAT_TOKEN || process.env.SCOREBAT_FEED_URL);
  const hasMatches = matches.length > 0;
  const setupHint = configured
    ? "The connected highlight feed returned no replay clips. Check /api/debug for the provider response."
    : "Add SCOREBAT_TOKEN in Vercel, or set SCOREBAT_FEED_URL to a ScoreBat-compatible JSON feed.";

  return {
    dataSource: "scorebat_highlights",
    feedUrl: publicFeedName(),
    configured,
    hasMatches,
    lastError: matchCache.lastError,
    lastCheckedAt: matchCache.lastCheckedAt,
    setupHint
  };
}

module.exports = {
  debugStatus,
  getMatch,
  getMatchBundle,
  getMatches,
  health,
  providerTest
};
