function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}

function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  res.statusCode = 204;
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.end();
  return true;
}

function ensureGet(req, res) {
  if (req.method === "GET") return true;
  sendJson(res, 405, { error: "method_not_allowed" });
  return false;
}

async function run(req, res, handler) {
  if (handleOptions(req, res) || !ensureGet(req, res)) return;

  try {
    await handler(req, res);
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
}

module.exports = { run, sendJson };
