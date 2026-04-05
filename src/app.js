const http = require("http");
const { healthHandler } = require("./routes/health");

const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    return healthHandler(req, res);
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

module.exports = { server };