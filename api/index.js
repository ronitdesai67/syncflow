// Vercel serverless entrypoint. An Express app is itself a valid
// (req, res) handler, so exporting it is all the Node runtime needs — every
// /api/* path is rewritten here by vercel.json and matched by the app's own
// router, which is why the routes keep their /api prefix.
module.exports = require('../server/src/app');
