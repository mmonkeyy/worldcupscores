const { getMatchBundle } = require("../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("./_helpers");

module.exports = (req, res) => run(req, res, async () => {
  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=900");
  sendJson(res, 200, await getMatchBundle());
});
