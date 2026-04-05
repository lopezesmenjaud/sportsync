const { ApiSportsProvider } = require("../providers/apiSports");
const { detectMatchChanges } = require("./matchChangeDetector");

function runTestSyncFlow() {
  const provider = new ApiSportsProvider();

  const rawOldMatch = {
    providerMatchId: "12345",
    sport: "football",
    competitionKey: "laliga",
    competitionName: "La Liga",
    homeParticipantName: "Real Madrid",
    awayParticipantName: "Barcelona",
    scheduledStartUtc: "2026-03-22T19:00:00Z",
    currentStartUtc: "2026-03-22T19:00:00Z",
    rawStatus: "NS",
    venueName: "Santiago Bernabéu",
    lastProviderUpdateUtc: "2026-03-22T18:50:00Z"
  };

  const rawNewMatch = {
    providerMatchId: "12345",
    sport: "football",
    competitionKey: "laliga",
    competitionName: "La Liga",
    homeParticipantName: "Real Madrid",
    awayParticipantName: "Barcelona",
    scheduledStartUtc: "2026-03-22T19:00:00Z",
    currentStartUtc: "2026-03-22T19:30:00Z",
    rawStatus: "DELAYED",
    venueName: "Santiago Bernabéu",
    lastProviderUpdateUtc: "2026-03-22T19:05:00Z"
  };

  const oldMatch = provider.normalizeMatch(rawOldMatch);
  const newMatch = provider.normalizeMatch(rawNewMatch);

  const changes = detectMatchChanges(oldMatch, newMatch);

  console.log("OLD MATCH:");
  console.log(JSON.stringify(oldMatch, null, 2));

  console.log("\nNEW MATCH:");
  console.log(JSON.stringify(newMatch, null, 2));

  console.log("\nDETECTED CHANGES:");
  console.log(JSON.stringify(changes, null, 2));
}

module.exports = { runTestSyncFlow };