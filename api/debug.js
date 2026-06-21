const { debugStatus } = require("../outputs/world-cup-live/api/_data");
const { run, sendJson } = require("./_helpers");

module.exports = (req, res) => run(req, res, async () => {
  sendJson(res, 200, await debugStatus());
});
