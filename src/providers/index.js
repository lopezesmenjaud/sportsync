const { ApiSportsProvider } = require("./apiSports");
const { TheSportsDbProvider } = require("./theSportsDb");

function getProvider(providerName) {
  switch (providerName) {
    case "api_sports":
      return new ApiSportsProvider();

    case "the_sports_db":
      return new TheSportsDbProvider();

    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

module.exports = { getProvider };