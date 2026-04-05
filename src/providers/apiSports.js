const { ProviderInterface } = require("./providerInterface");
const { createMatch } = require("../domain/matchModel");
const { mapApiSportsStatus } = require("../domain/statusMap");

class ApiSportsProvider extends ProviderInterface {
  async getMatchesByDate() {
    // Placeholder por ahora
    return [];
  }

  normalizeMatch(rawMatch) {
    return createMatch({
      internalMatchId: `api_sports_${rawMatch.providerMatchId}`,
      provider: "api_sports",
      providerMatchId: rawMatch.providerMatchId,
      sport: rawMatch.sport,
      competitionKey: rawMatch.competitionKey,
      competitionName: rawMatch.competitionName,
      homeParticipantName: rawMatch.homeParticipantName,
      awayParticipantName: rawMatch.awayParticipantName,
      scheduledStartUtc: rawMatch.scheduledStartUtc,
      currentStartUtc: rawMatch.currentStartUtc,
      status: mapApiSportsStatus(rawMatch.rawStatus),
      rawStatus: rawMatch.rawStatus,
      venueName: rawMatch.venueName,
      lastProviderUpdateUtc: rawMatch.lastProviderUpdateUtc
    });
  }

  mapStatus(rawStatus) {
    return mapApiSportsStatus(rawStatus);
  }
}

module.exports = { ApiSportsProvider };