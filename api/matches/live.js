const { getMatches } = require("../../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("../_helpers");

module.exports = (req, res) => run(req, res, async () => {
  const matches = await getMatches();
  res.setHeader("cache-control", "s-maxage=120, stale-while-revalidate=300");
  sendJson(res, 200, { matches: matches.filter((match) => match.status === "live") });
});
