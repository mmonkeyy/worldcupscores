const { getMatch } = require("../../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("../_helpers");

module.exports = (req, res) => run(req, res, async () => {
  const match = await getMatch(req.query.id);

  if (!match) {
    sendJson(res, 404, { error: "match_not_found" });
    return;
  }

  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=120");
  sendJson(res, 200, { match });
});
