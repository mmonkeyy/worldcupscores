const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { debugStatus, getMatch, getMatchBundle, getMatches, health, providerTest } = require("./_data");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = path.resolve(__dirname, "..");

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
  console.log(`World Cup app running at http://${HOST}:${PORT}/`);
});

async function routeApi(req, res, reqUrl) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const parts = reqUrl.pathname.split("/").filter(Boolean);

  if (reqUrl.pathname === "/api/health") {
    sendJson(res, 200, await health());
    return;
  }

  if (reqUrl.pathname === "/api/debug" || reqUrl.pathname === "/api/provider-test") {
    sendJson(res, 200, reqUrl.pathname === "/api/debug" ? await debugStatus() : await providerTest());
    return;
  }

  if (reqUrl.pathname === "/api/matches") {
    sendJson(res, 200, await getMatchBundle());
    return;
  }

  if (reqUrl.pathname === "/api/matches/live") {
    const matches = await getMatches();
    sendJson(res, 200, { matches: matches.filter((match) => match.status === "live") });
    return;
  }

  if (parts[0] === "api" && parts[1] === "matches" && parts[2]) {
    const match = await getMatch(decodeURIComponent(parts[2]));
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
    ".png": "image/png"
  }[ext] || "application/octet-stream";
}
