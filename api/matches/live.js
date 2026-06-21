const { getMatches } = require("../../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("../_helpers");

module.exports = (req, res) => run(req, res, async () => {
  const matches = await getMatches();
  sendJson(res, 200, { matches: matches.filter((match) => match.status === "live") });
});
