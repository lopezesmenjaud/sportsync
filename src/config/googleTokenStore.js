const fs = require("fs");
const path = require("path");

const tokenPath = path.resolve(__dirname, "../../token.json");

function saveTokens(tokens) {
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
}

function loadTokens() {
  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  const raw = fs.readFileSync(tokenPath, "utf-8");
  return JSON.parse(raw);
}

module.exports = {
  saveTokens,
  loadTokens
};