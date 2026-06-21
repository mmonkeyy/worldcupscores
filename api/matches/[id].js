const { getMatch } = require("../../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("../_helpers");

module.exports = (req, res) => run(req, res, async () => {
  const match = await getMatch(req.query.id);

  if (!match) {
    sendJson(res, 404, { error: "match_not_found" });
    return;
  }

  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=900");
  sendJson(res, 200, { match });
});
