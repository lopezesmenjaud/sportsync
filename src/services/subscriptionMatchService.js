const { subscriptionRepository } = require("../repositories/subscriptionRepositorySqlite");
const { matchRepository } = require("../repositories/matchRepositorySqlite");
const { normalizeSport } = require("./syncService");

function matchAppliesToSubscription(match, subscription) {
  if (subscription.sport && normalizeSport(subscription.sport) !== normalizeSport(match.sport)) {
    return false;
  }

  if (
    subscription.competitionKey &&
    match.competitionKey !== subscription.competitionKey
  ) {
    return false;
  }

  if (subscription.teamName) {
    const teamName = subscription.teamName.toLowerCase();
    const home = (match.homeParticipantName || "").toLowerCase();
    const away = (match.awayParticipantName || "").toLowerCase();

    if (home !== teamName && away !== teamName) {
      return false;
    }
  }

  return true;
}

async function getMatchesForUser(userId) {
  const subscriptions = await subscriptionRepository.getByUserId(userId);
  const matches = await matchRepository.getAll();

  const relevantMatches = matches.filter((match) =>
    subscriptions.some((subscription) =>
      matchAppliesToSubscription(match, subscription)
    )
  );

  return relevantMatches;
}

module.exports = {
  getMatchesForUser,
  matchAppliesToSubscription
};